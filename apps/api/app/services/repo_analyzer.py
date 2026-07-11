"""Single-call repo → marketplace-listing analyzer.

Transliterated from kc:backend/src/services/repo-analyzer.ts. Given a
GitHub URL it shallow-clones the repo into a temp dir, reads the README +
primary manifest + a 2-level file tree, sends them to OpenRouter (default
model anthropic/claude-sonnet-4), and parses the strict-JSON spec into a
dict that the submit router uses to create a draft Tool row.

In development, the analyzer can fall back to a manifest-based heuristic when
OpenRouter is unavailable. In production, the fallback is disabled unless
ALLOW_REPO_ANALYSIS_FALLBACK=true is set, so real submissions do not silently
ship guessed metadata.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

README_NAMES = ["README.md", "README.MD", "Readme.md", "readme.md", "README"]
MANIFEST_NAMES = [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "Gemfile",
]
SKIP_DIRS = frozenset(
    {
        "node_modules",
        "__pycache__",
        ".git",
        "dist",
        "build",
        ".next",
        "target",
        "venv",
        ".venv",
    }
)

# Categories the kc Module shape uses (same as @hackmarket/shared CATEGORIES).
_VALID_CATEGORIES = {
    "Auth",
    "Payments",
    "Notifications",
    "Analytics",
    "AI/ML",
    "DevOps",
    "UI Components",
    "Data Pipelines",
}
_VALID_COMPLEXITY = {"Easy", "Medium", "Advanced"}
_VALID_PRICING = {"buy", "royalty"}

# Map the kc Category string → the FastAPI ToolCategory enum value.
_CATEGORY_TO_TOOL_CATEGORY = {
    "Auth": "automation",
    "Payments": "automation",
    "Notifications": "automation",
    "Analytics": "data_analysis",
    "AI/ML": "nlp",
    "DevOps": "automation",
    "UI Components": "other",
    "Data Pipelines": "data_analysis",
}


class RepoAnalysisUnavailable(RuntimeError):
    """Raised when live repo analysis cannot run and fallback is not allowed."""


@dataclass
class RepoAnalysis:
    name: str
    description: str
    category: str  # raw kc-shape Category
    tool_category: str  # mapped FastAPI ToolCategory value
    tech_stack: list[str]
    input_contract: str
    output_contract: str
    complexity: str
    suggested_price_cents: int
    pricing_model: str


SYSTEM_PROMPT = """You analyze GitHub repositories and produce metadata for Hackmarket, a marketplace where repos become callable APIs.

Return ONLY a single valid JSON object with this exact shape (no markdown, no commentary):
{
  "name": "string — short product name, 2-5 words",
  "description": "string — one sentence: what it does + who it's for",
  "category": "string — exactly one of: Auth, Payments, Notifications, Analytics, AI/ML, DevOps, UI Components, Data Pipelines",
  "techStack": ["array of short strings — primary tech, e.g. Node.js, FastAPI, Python, TypeScript, React"],
  "inputContract": "string — concise description of the request body shape clients should send",
  "outputContract": "string — concise description of the response body shape clients receive",
  "complexity": "string — exactly one of: Easy, Medium, Advanced",
  "suggestedPrice": "number — price in USD cents, typically 500-50000",
  "pricingModel": "string — exactly one of: buy (one-time purchase, e.g. components/libs), royalty (usage-based, e.g. APIs/infra)"
}

Use 'AI/ML' if any LLM, embedding, or inference is involved. Use 'DevOps' for tooling/CI/CD. Default category 'AI/ML' if genuinely unclear.
Be honest — minimal repos get complexity Easy and a low price."""


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------


def _read_first_existing(repo: Path, names: list[str]) -> tuple[str, str] | None:
    for name in names:
        path = repo / name
        if not path.exists() or not path.is_file():
            continue
        try:
            return name, path.read_text(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            continue
    return None


def _build_file_tree(repo: Path, max_depth: int = 2) -> list[str]:
    lines: list[str] = []

    def walk(path: Path, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            items = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name))
        except OSError:
            return
        for item in items:
            if item.name.startswith(".") or item.name in SKIP_DIRS:
                continue
            indent = "  " * depth
            if item.is_dir():
                lines.append(f"{indent}{item.name}/")
                walk(item, depth + 1)
            else:
                lines.append(f"{indent}{item.name}")

    walk(repo, 0)
    return lines


# ---------------------------------------------------------------------------
# Git clone
# ---------------------------------------------------------------------------


async def clone_repo(github_url: str, target_path: Path) -> None:
    """Shallow, single-branch git clone."""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if target_path.exists():
        shutil.rmtree(target_path, ignore_errors=True)

    def _run() -> None:
        subprocess.run(
            [
                "git",
                "clone",
                "--depth",
                "1",
                "--single-branch",
                github_url,
                str(target_path),
            ],
            check=True,
            capture_output=True,
            timeout=60,
        )

    await asyncio.to_thread(_run)


# ---------------------------------------------------------------------------
# OpenRouter call + heuristic fallback
# ---------------------------------------------------------------------------


async def _call_openrouter(user_prompt: str) -> str:
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.openrouter_app_url,
        "X-Title": settings.openrouter_app_name,
    }
    payload = {
        "model": settings.openrouter_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": 2000,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            json=payload,
            headers=headers,
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"OpenRouter {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"OpenRouter error: {data['error']}")
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content")
    if not isinstance(text, str) or not text:
        raise RuntimeError("OpenRouter returned empty content")
    return text


def _fallback_allowed() -> bool:
    return settings.environment != "production" or settings.allow_repo_analysis_fallback


def _parse_and_validate(text: str, fallback: RepoAnalysis, allow_fallback: bool) -> RepoAnalysis:
    """Parse the LLM's JSON, fall back to heuristic on any malformed field."""

    def fallback_or_raise(reason: str) -> RepoAnalysis:
        if allow_fallback:
            return fallback
        raise RepoAnalysisUnavailable(f"Repository analysis returned invalid output: {reason}.")

    stripped = text.strip()
    stripped = re.sub(r"^```(?:json)?\s*", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"```\s*$", "", stripped)

    parsed: Any = None
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", stripped)
        if match:
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                return fallback_or_raise("malformed JSON")
        else:
            return fallback_or_raise("missing JSON object")
    if not isinstance(parsed, dict):
        return fallback_or_raise("top-level value is not an object")

    category = parsed.get("category")
    if category not in _VALID_CATEGORIES:
        category = fallback.category
    complexity = parsed.get("complexity")
    if complexity not in _VALID_COMPLEXITY:
        complexity = fallback.complexity
    pricing_model = parsed.get("pricingModel")
    if pricing_model not in _VALID_PRICING:
        pricing_model = fallback.pricing_model

    name = parsed.get("name")
    name = name.strip()[:80] if isinstance(name, str) and name.strip() else fallback.name

    description = parsed.get("description")
    description = (
        description.strip()[:500]
        if isinstance(description, str) and description.strip()
        else fallback.description
    )

    tech_stack_raw = parsed.get("techStack")
    if isinstance(tech_stack_raw, list):
        tech_stack = [str(t) for t in tech_stack_raw[:10] if t]
    else:
        tech_stack = fallback.tech_stack

    input_contract = parsed.get("inputContract")
    input_contract = (
        input_contract[:800] if isinstance(input_contract, str) else fallback.input_contract
    )
    output_contract = parsed.get("outputContract")
    output_contract = (
        output_contract[:800] if isinstance(output_contract, str) else fallback.output_contract
    )

    suggested_price = parsed.get("suggestedPrice")
    if isinstance(suggested_price, (int, float)) and suggested_price >= 0:
        suggested_price_cents = int(round(suggested_price))
    else:
        suggested_price_cents = fallback.suggested_price_cents

    return RepoAnalysis(
        name=name,
        description=description,
        category=category,
        tool_category=_CATEGORY_TO_TOOL_CATEGORY.get(category, "automation"),
        tech_stack=tech_stack,
        input_contract=input_contract,
        output_contract=output_contract,
        complexity=complexity,
        suggested_price_cents=suggested_price_cents,
        pricing_model=pricing_model,
    )


def _heuristic_analysis(
    github_url: str,
    readme: str | None,
    manifest: tuple[str, str] | None,
) -> RepoAnalysis:
    repo_name = os.path.basename(github_url.rstrip("/").removesuffix(".git"))
    first_header = None
    if readme:
        for line in readme.splitlines():
            stripped = line.strip()
            if stripped:
                first_header = re.sub(r"^#+\s*", "", stripped).strip()
                break

    tech_stack: list[str] = []
    if manifest:
        name, content = manifest
        if name == "package.json":
            tech_stack.extend(["Node.js", "JavaScript"])
        if name in ("requirements.txt", "pyproject.toml"):
            tech_stack.append("Python")
        if name == "go.mod":
            tech_stack.append("Go")
        if name == "Cargo.toml":
            tech_stack.append("Rust")
        if name == "Gemfile":
            tech_stack.append("Ruby")
        if "typescript" in content.lower() or "@types/" in content:
            tech_stack.append("TypeScript")
        if "fastapi" in content.lower():
            tech_stack.append("FastAPI")
        if '"react"' in content or "@vitejs/plugin-react" in content:
            tech_stack.append("React")

    description = f"Imported from {github_url}."
    if readme:
        for line in readme.splitlines():
            s = line.strip()
            if s and not s.startswith("#"):
                description = s[:200]
                break

    name = (first_header or repo_name)[:80]
    category = "AI/ML"
    return RepoAnalysis(
        name=name,
        description=description,
        category=category,
        tool_category=_CATEGORY_TO_TOOL_CATEGORY[category],
        tech_stack=tech_stack,
        input_contract="JSON object — schema to be defined by submitter.",
        output_contract="JSON object — schema to be defined by submitter.",
        complexity="Medium",
        suggested_price_cents=1000,
        pricing_model="buy",
    )


async def analyze_repo(repo_path: Path, github_url: str) -> RepoAnalysis:
    readme = _read_first_existing(repo_path, README_NAMES)
    manifest = _read_first_existing(repo_path, MANIFEST_NAMES)
    tree = _build_file_tree(repo_path, max_depth=2)

    fallback = _heuristic_analysis(github_url, readme[1] if readme else None, manifest)

    allow_fallback = _fallback_allowed()

    if not settings.openrouter_api_key:
        if not allow_fallback:
            raise RepoAnalysisUnavailable(
                "Repository analysis requires OPENROUTER_API_KEY in production."
            )
        return fallback

    user_prompt = "\n".join(
        [
            f"Repo URL: {github_url}",
            "",
            f"--- README ({readme[0] if readme else 'none'}) ---",
            readme[1][:8000] if readme else "(no README found)",
            "",
            f"--- Manifest ({manifest[0] if manifest else 'none'}) ---",
            manifest[1][:4000] if manifest else "(no manifest found)",
            "",
            "--- File tree (top 2 levels, first 150 entries) ---",
            "\n".join(tree[:150]),
        ]
    )

    try:
        text = await _call_openrouter(user_prompt)
    except Exception as exc:  # noqa: BLE001
        if not allow_fallback:
            raise RepoAnalysisUnavailable(
                "Repository analysis is unavailable right now. Please try again later."
            ) from exc
        logger.warning("[repo_analyzer] OpenRouter call failed (%s); using heuristic fallback", exc)
        return fallback

    return _parse_and_validate(text, fallback, allow_fallback)
