import asyncio
import logging
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

import httpx

from app.config import settings
from app.dependencies import AsyncSessionLocal, _redis_client
from app.models import Tool
from app.models.tool import ToolStatus
from app.services import render_service, storage_service, tool_service
from app.services.port_manager import PortManager
from app.services.source_archive import SourceArchiveError, extract_safe_zip

logger = logging.getLogger(__name__)


class ContainerBuildError(RuntimeError):
    """User-safe build and deployment failure."""


@dataclass
class ProjectAnalysis:
    source_path: str
    language: str
    framework: str | None
    entry_point: str | None
    port: int | None
    dependencies_file: str | None
    has_dockerfile: bool


@dataclass
class ToolConfig:
    entry_command: str
    port: int
    environment_variables: dict[str, str]


@dataclass
class ProcessUploadResult:
    succeeded: bool
    api_endpoint: str | None = None
    error_message: str | None = None


class ContainerBuilder:
    def __init__(self) -> None:
        self.port_manager = PortManager(_redis_client)
        self._active_build_args: dict[str, str] = {}

    async def analyze_project(self, source_path: str) -> ProjectAnalysis:
        root = Path(source_path)
        language, dependencies_file = self._detect_language(root)
        if language is None:
            raise ContainerBuildError(
                "We couldn't detect a supported project type. Add requirements.txt, package.json, Cargo.toml, or go.mod."
            )

        framework = self._detect_framework(root, language)
        entry_point = self._find_entry_point(root, language)
        port = self._find_port(root)

        return ProjectAnalysis(
            source_path=str(root),
            language=language,
            framework=framework,
            entry_point=entry_point,
            port=port,
            dependencies_file=dependencies_file,
            has_dockerfile=(root / "Dockerfile").exists(),
        )

    async def generate_dockerfile(self, analysis: ProjectAnalysis, config: ToolConfig) -> str:
        self._active_build_args = dict(config.environment_variables)
        if analysis.has_dockerfile:
            dockerfile_path = Path(analysis.source_path) / "Dockerfile"
            existing = dockerfile_path.read_text(encoding="utf-8")
            self._validate_existing_dockerfile(existing)
            return existing

        if analysis.language == "python":
            if not analysis.dependencies_file:
                raise ContainerBuildError("Python projects need a requirements.txt or pyproject.toml file.")
            install_line = (
                f"RUN pip install --no-cache-dir -r {analysis.dependencies_file}"
                if analysis.dependencies_file.endswith(".txt")
                else "RUN pip install --no-cache-dir ."
            )
            return "\n".join(
                [
                    "FROM python:3.11-slim",
                    "WORKDIR /app",
                    *self._build_arg_lines(config.environment_variables),
                    f"COPY {analysis.dependencies_file} .",
                    *([] if analysis.dependencies_file.endswith(".txt") else ["COPY . ."]),
                    install_line,
                    *([] if not analysis.dependencies_file.endswith(".txt") else ["COPY . ."]),
                    f"EXPOSE {config.port}",
                    f'CMD ["sh", "-c", "{self._escape_shell(config.entry_command)}"]',
                    "",
                ]
            )

        if analysis.language == "node":
            dependencies_file = analysis.dependencies_file or "package.json"
            copy_line = "COPY package*.json ." if dependencies_file == "package.json" else f"COPY {dependencies_file} ."
            return "\n".join(
                [
                    "FROM node:20-slim",
                    "WORKDIR /app",
                    *self._build_arg_lines(config.environment_variables),
                    copy_line,
                    "RUN npm ci --production",
                    "COPY . .",
                    f"EXPOSE {config.port}",
                    f'CMD ["sh", "-c", "{self._escape_shell(config.entry_command)}"]',
                    "",
                ]
            )

        if analysis.language == "rust":
            return "\n".join(
                [
                    "FROM rust:1.77-slim as builder",
                    "WORKDIR /app",
                    "COPY . .",
                    "RUN cargo build --release",
                    "FROM debian:bookworm-slim",
                    "WORKDIR /app",
                    "COPY --from=builder /app/target/release /app/bin",
                    f"EXPOSE {config.port}",
                    f'CMD ["sh", "-c", "{self._escape_shell(config.entry_command)}"]',
                    "",
                ]
            )

        if analysis.language == "go":
            return "\n".join(
                [
                    "FROM golang:1.22 as builder",
                    "WORKDIR /app",
                    "COPY . .",
                    'RUN CGO_ENABLED=0 GOOS=linux go build -o /tmp/app ./...',
                    "FROM debian:bookworm-slim",
                    "WORKDIR /app",
                    "COPY --from=builder /tmp/app /app/app",
                    f"EXPOSE {config.port}",
                    f'CMD ["sh", "-c", "{self._escape_shell(config.entry_command)}"]',
                    "",
                ]
            )

        raise ContainerBuildError(f"Unsupported language '{analysis.language}'.")

    async def build_and_push(self, tool_id: UUID, source_path: str, dockerfile: str) -> str:
        self._ensure_command_available(
            "docker",
            "Automated container builds are not available on this host yet. Re-run uploads on a Docker-capable runtime.",
        )
        dockerfile_path = Path(source_path) / "Dockerfile"
        dockerfile_path.write_text(dockerfile, encoding="utf-8")

        image_uri = f"hackmarket/{tool_id}:latest"
        command = [
            "docker",
            "build",
            "-t",
            image_uri,
        ]
        for key, value in self._active_build_args.items():
            command.extend(["--build-arg", f"{key}={value}"])
        command.append(source_path)

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            raise ContainerBuildError(self._clean_process_error("Docker build failed", stdout, stderr))

        return image_uri

    async def deploy(self, tool_id: UUID, image_uri: str, config: ToolConfig) -> str:
        assigned_port = await self.port_manager.allocate()
        container_name = f"hm-{tool_id}"

        try:
            await self._remove_existing_container(container_name)

            command = [
                "docker",
                "run",
                "-d",
                "--name",
                container_name,
                "-p",
                f"{assigned_port}:{config.port}",
            ]
            for key, value in config.environment_variables.items():
                command.extend(["-e", f"{key}={value}"])
            command.append(image_uri)

            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()
            if process.returncode != 0:
                raise ContainerBuildError(self._clean_process_error("Container startup failed", stdout, stderr))

            await self._wait_for_healthcheck(assigned_port)
            return f"http://localhost:{assigned_port}"
        except Exception:
            await self._remove_existing_container(container_name)
            await self.port_manager.release(assigned_port)
            raise

    async def process_upload(self, tool_id: UUID, *, final_attempt: bool = True) -> ProcessUploadResult:
        async with AsyncSessionLocal() as db:
            tool = await tool_service.get_tool_by_id(db, tool_id)
            if not tool:
                logger.warning("Skipping tool processing for missing tool %s", tool_id)
                return ProcessUploadResult(succeeded=False, error_message="Tool was not found.")

            source_dir: Path | None = None
            deployed_port: int | None = None
            try:
                tool.status = ToolStatus.processing
                tool.processing_error = None
                await db.commit()

                with tempfile.TemporaryDirectory(prefix=f"tool-{tool_id}-") as temp_dir:
                    source_dir = await self._prepare_source(tool, temp_dir)
                    config = self._tool_config_from_tool(tool)
                    analysis = await self.analyze_project(str(source_dir))

                    inferred_entry = analysis.entry_point and not tool.entry_command
                    inferred_port = analysis.port and tool.port == 8080
                    if inferred_entry and analysis.entry_point:
                        config.entry_command = self._default_entry_command(analysis.language, analysis.entry_point)
                    if inferred_port and analysis.port:
                        config.port = analysis.port

                    image_uri: str | None = None
                    if render_service.render_deployments_enabled() and tool.github_url:
                        api_endpoint = await render_service.deploy_tool_to_render(tool, analysis, config)
                    elif render_service.render_image_deployments_enabled() and tool.source_s3_key:
                        dockerfile = await self.generate_dockerfile(analysis, config)
                        image_uri = await self.build_and_push(tool_id, str(source_dir), dockerfile)
                        api_endpoint = await render_service.deploy_image_to_render(tool, image_uri)
                    elif render_service.render_deployments_enabled() and tool.source_s3_key and settings.environment == "production":
                        raise ContainerBuildError(
                            "Automatic Render hosting for zip uploads still needs GHCR credentials and a Docker-capable builder host."
                        )
                    else:
                        dockerfile = await self.generate_dockerfile(analysis, config)
                        image_uri = await self.build_and_push(tool_id, str(source_dir), dockerfile)
                        api_endpoint = await self.deploy(tool_id, image_uri, config)
                        deployed_port = self._extract_port(api_endpoint)

                    tool.status = ToolStatus.live
                    tool.processing_error = None
                    tool.api_endpoint = api_endpoint
                    tool.docker_image_uri = image_uri
                    tool.source_file_tree = self._build_source_tree(source_dir)
                    await db.commit()
                    return ProcessUploadResult(succeeded=True, api_endpoint=api_endpoint)
            except Exception as exc:
                logger.exception("Tool %s processing failed", tool_id)
                if deployed_port is not None:
                    await self._remove_existing_container(f"hm-{tool_id}")
                    await self.port_manager.release(deployed_port)
                clean_message = self._clean_exception_message(exc)
                tool.status = ToolStatus.rejected if final_attempt else ToolStatus.processing
                tool.processing_error = (
                    clean_message
                    if final_attempt
                    else f"Retrying after a transient processing failure: {clean_message}"
                )
                await db.commit()
                return ProcessUploadResult(succeeded=False, error_message=clean_message)

    async def _prepare_source(self, tool: Tool, temp_dir: str) -> Path:
        worktree = Path(temp_dir) / "source"

        if tool.source_s3_key:
            archive_bytes = await storage_service.download_bytes(tool.source_s3_key)
            archive_path = Path(temp_dir) / "source.zip"
            archive_path.write_bytes(archive_bytes)

            def _extract() -> None:
                extract_safe_zip(
                    archive_path,
                    worktree,
                    max_entries=settings.max_source_zip_entries,
                    max_uncompressed_bytes=settings.max_source_zip_uncompressed_bytes,
                )

            try:
                await asyncio.to_thread(_extract)
            except SourceArchiveError as exc:
                raise ContainerBuildError(str(exc)) from exc
            return self._normalize_source_root(worktree)

        if tool.github_url:
            await self._fetch_github_source(tool.github_url, worktree)
            return worktree

        raise ContainerBuildError("No uploaded source was found for this tool.")

    async def _fetch_github_source(self, github_url: str, destination: Path) -> None:
        if await self._try_download_github_archive(github_url, destination):
            return
        await self._clone_repo(github_url, destination)

    async def _clone_repo(self, github_url: str, destination: Path) -> None:
        self._ensure_command_available(
            "git",
            "Git is not available on this host, so GitHub imports cannot be cloned right now.",
        )
        process = await asyncio.create_subprocess_exec(
            "git",
            "clone",
            "--depth",
            "1",
            github_url,
            str(destination),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            raise ContainerBuildError(self._clean_process_error("Failed to clone GitHub repository", stdout, stderr))

    async def _try_download_github_archive(self, github_url: str, destination: Path) -> bool:
        parsed = urlparse(github_url)
        if parsed.netloc.lower() not in {"github.com", "www.github.com"}:
            return False

        parts = [part for part in parsed.path.strip("/").split("/") if part]
        if len(parts) < 2:
            return False

        owner, repo = parts[0], parts[1].removesuffix(".git")
        branch = await self._github_default_branch(owner, repo)
        archive_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{branch}"

        archive_path = destination.parent / "github-source.zip"
        destination.mkdir(parents=True, exist_ok=True)

        try:
            from app.services.proxy_service import get_http_client
            client = get_http_client()
            response = await client.get(archive_url, timeout=30, follow_redirects=True)
            response.raise_for_status()
            archive_path.write_bytes(response.content)

            def _extract() -> None:
                extract_safe_zip(
                    archive_path,
                    destination,
                    max_entries=settings.max_source_zip_entries,
                    max_uncompressed_bytes=settings.max_source_zip_uncompressed_bytes,
                )

            await asyncio.to_thread(_extract)
            normalized = self._normalize_source_root(destination)
            if normalized != destination:
                for child in list(destination.iterdir()):
                    if child == normalized:
                        continue
                    if child.is_dir():
                        shutil.rmtree(child, ignore_errors=True)
                    else:
                        child.unlink(missing_ok=True)
                for child in normalized.iterdir():
                    shutil.move(str(child), destination / child.name)
                shutil.rmtree(normalized, ignore_errors=True)
            return True
        except (httpx.HTTPError, OSError, SourceArchiveError):
            return False

    async def _github_default_branch(self, owner: str, repo: str) -> str:
        api_url = f"https://api.github.com/repos/{owner}/{repo}"
        from app.services.proxy_service import get_http_client
        client = get_http_client()
        response = await client.get(api_url, timeout=15, headers={"Accept": "application/vnd.github+json"})
        response.raise_for_status()
        payload = response.json()
        branch = payload.get("default_branch")
        if not isinstance(branch, str) or not branch:
            raise ContainerBuildError("We couldn't determine the repository's default branch.")
        return branch

    async def _remove_existing_container(self, container_name: str) -> None:
        process = await asyncio.create_subprocess_exec(
            "docker",
            "rm",
            "-f",
            container_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await process.communicate()

    async def _wait_for_healthcheck(self, port: int) -> None:
        candidates = [f"http://localhost:{port}/health", f"http://localhost:{port}/"]
        async with httpx.AsyncClient(timeout=2) as client:
            for _ in range(15):
                for url in candidates:
                    try:
                        response = await client.get(url)
                        if response.status_code < 500:
                            return
                    except httpx.HTTPError:
                        continue
                await asyncio.sleep(2)
        raise ContainerBuildError("The container started but did not become healthy within 30 seconds.")

    def _tool_config_from_tool(self, tool: Tool) -> ToolConfig:
        environment_variables = {
            item["key"]: item["value"]
            for item in (tool.environment_variables or [])
            if item.get("key") and item.get("value") is not None
        }
        entry_command = tool.entry_command
        if not entry_command:
            raise ContainerBuildError(
                "No entry command is configured for this tool. Save the runtime configuration before uploading."
            )
        return ToolConfig(
            entry_command=entry_command,
            port=tool.port or 8080,
            environment_variables=environment_variables,
        )

    def _detect_language(self, root: Path) -> tuple[str | None, str | None]:
        if (root / "requirements.txt").exists():
            return "python", "requirements.txt"
        if (root / "package.json").exists():
            return "node", "package.json"
        if (root / "Cargo.toml").exists():
            return "rust", "Cargo.toml"
        if (root / "go.mod").exists():
            return "go", "go.mod"
        pyproject = root / "pyproject.toml"
        if pyproject.exists():
            return "python", "pyproject.toml"
        return None, None

    def _detect_framework(self, root: Path, language: str) -> str | None:
        sample = self._sample_project_text(root)

        framework_patterns = {
            "python": {
                "fastapi": r"\bfastapi\b",
                "flask": r"\bflask\b",
                "django": r"\bdjango\b",
            },
            "node": {
                "express": r"\bexpress\b",
                "next": r"\bnext\b",
                "koa": r"\bkoa\b",
            },
            "rust": {
                "actix": r"\bactix\b",
                "rocket": r"\brocket\b",
            },
            "go": {
                "gin": r"\bgin\b",
                "fiber": r"\bfiber\b",
            },
        }

        for framework, pattern in framework_patterns.get(language, {}).items():
            if re.search(pattern, sample, re.IGNORECASE):
                return framework
        return None

    def _find_entry_point(self, root: Path, language: str) -> str | None:
        candidates = {
            "python": ["main.py", "app.py", "server.py"],
            "node": ["index.js", "server.js", "app.js"],
            "rust": ["src/main.rs"],
            "go": ["main.go", "cmd/main.go"],
        }
        for candidate in candidates.get(language, []):
            if (root / candidate).exists():
                return candidate
        return None

    def _find_port(self, root: Path) -> int | None:
        sample = self._sample_project_text(root)
        patterns = [
            r"\.listen\(\s*(\d{2,5})",
            r"port\s*=\s*(\d{2,5})",
            r"PORT\s*[:=]\s*[\"']?(\d{2,5})",
            r"localhost:(\d{2,5})",
        ]
        for pattern in patterns:
            match = re.search(pattern, sample, re.IGNORECASE)
            if match:
                return int(match.group(1))
        return None

    def _sample_project_text(self, root: Path) -> str:
        snippets: list[str] = []
        for path in sorted(root.rglob("*")):
            if not path.is_file() or ".git" in path.parts:
                continue
            if path.suffix.lower() not in {".py", ".js", ".ts", ".json", ".toml", ".go", ".rs", ".txt"}:
                continue
            try:
                snippets.append(path.read_text(encoding="utf-8", errors="ignore")[:4000])
            except OSError:
                continue
            if sum(len(snippet) for snippet in snippets) >= 12000:
                break
        return "\n".join(snippets)

    def _validate_existing_dockerfile(self, dockerfile: str) -> None:
        if "FROM " not in dockerfile.upper():
            raise ContainerBuildError("The existing Dockerfile is missing a FROM instruction.")
        if "CMD " not in dockerfile.upper() and "ENTRYPOINT " not in dockerfile.upper():
            raise ContainerBuildError("The existing Dockerfile needs a CMD or ENTRYPOINT instruction.")

    def _build_arg_lines(self, environment_variables: dict[str, str]) -> list[str]:
        lines: list[str] = []
        for key in environment_variables:
            lines.append(f"ARG {key}")
            lines.append(f"ENV {key}=${key}")
        return lines

    def _default_entry_command(self, language: str, entry_point: str) -> str:
        if language == "python":
            return f"python {entry_point}"
        if language == "node":
            return f"node {entry_point}"
        if language == "rust":
            binary_name = Path(entry_point).stem
            return f"/app/bin/{binary_name}"
        if language == "go":
            return "/app/app"
        raise ContainerBuildError("Unable to infer a default entry command for this project.")

    def _escape_shell(self, command: str) -> str:
        return command.replace("\\", "\\\\").replace('"', '\\"')

    def _normalize_source_root(self, source_dir: Path) -> Path:
        children = [child for child in source_dir.iterdir() if child.name != "__MACOSX"]
        if len(children) == 1 and children[0].is_dir():
            return children[0]
        return source_dir

    def _build_source_tree(self, source_dir: Path) -> list[str]:
        paths: list[str] = []
        for path in sorted(source_dir.rglob("*")):
            if ".git" in path.parts:
                continue
            relative = path.relative_to(source_dir).as_posix()
            if path.is_dir():
                relative = f"{relative}/"
            paths.append(relative)
            if len(paths) >= 200:
                break
        return paths

    def _clean_process_error(self, prefix: str, stdout: bytes, stderr: bytes) -> str:
        detail = (stderr or stdout).decode("utf-8", errors="ignore").strip()
        detail = detail.splitlines()[-1] if detail else "No details were returned."
        return f"{prefix}. {detail}"

    def _clean_exception_message(self, exc: Exception) -> str:
        if isinstance(exc, ContainerBuildError):
            return str(exc)
        message = str(exc).strip()
        return message or "The build pipeline failed unexpectedly."

    def _extract_port(self, api_endpoint: str) -> int | None:
        try:
            return int(api_endpoint.rsplit(":", 1)[1])
        except (IndexError, ValueError):
            return None

    def _ensure_command_available(self, command: str, message: str) -> None:
        if shutil.which(command):
            return
        raise ContainerBuildError(message)


async def process_tool_upload(tool_id: UUID, *, final_attempt: bool = True) -> ProcessUploadResult:
    builder = ContainerBuilder()
    return await builder.process_upload(tool_id, final_attempt=final_attempt)
