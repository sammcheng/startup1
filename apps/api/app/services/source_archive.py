from __future__ import annotations

import io
import shutil
import stat
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath


class SourceArchiveError(RuntimeError):
    """Raised when an uploaded source archive is unsafe or unsupported."""

    def __init__(self, message: str, *, filename: str | None = None) -> None:
        super().__init__(message)
        self.filename = filename


def _is_zip_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return stat.S_ISLNK(mode)


def _normalized_member_name(filename: str) -> str:
    normalized = filename.replace("\\", "/").strip()
    path = PurePosixPath(normalized)
    windows_path = PureWindowsPath(filename)

    if (
        not normalized
        or normalized == "."
        or normalized.startswith("/")
        or filename.startswith("\\")
        or path.is_absolute()
        or windows_path.is_absolute()
        or windows_path.drive
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise SourceArchiveError(
            "The uploaded zip contains an unsafe file path.",
            filename=filename,
        )

    return path.as_posix()


def _iter_source_members(
    archive: zipfile.ZipFile,
    *,
    max_entries: int,
    max_uncompressed_bytes: int,
) -> list[tuple[zipfile.ZipInfo, str]]:
    members: list[tuple[zipfile.ZipInfo, str]] = []
    seen_paths: set[str] = set()
    total_uncompressed_bytes = 0

    for info in archive.infolist():
        if info.filename.startswith("__MACOSX/") or not info.filename.strip("/\\"):
            continue
        if _is_zip_symlink(info):
            raise SourceArchiveError(
                "The uploaded zip contains a symbolic link, which is not supported.",
                filename=info.filename,
            )

        normalized_name = _normalized_member_name(info.filename)
        if normalized_name in seen_paths:
            raise SourceArchiveError(
                "The uploaded zip contains duplicate file paths.",
                filename=info.filename,
            )
        seen_paths.add(normalized_name)

        if not info.is_dir():
            total_uncompressed_bytes += info.file_size
            if total_uncompressed_bytes > max_uncompressed_bytes:
                raise SourceArchiveError("The uploaded zip expands beyond the allowed source size.")

        members.append((info, normalized_name))
        if len(members) > max_entries:
            raise SourceArchiveError("The uploaded zip contains too many files.")

    return members


def list_safe_zip_entries(
    file_bytes: bytes,
    *,
    max_entries: int,
    max_uncompressed_bytes: int,
    preview_limit: int = 200,
) -> list[str]:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            members = _iter_source_members(
                archive,
                max_entries=max_entries,
                max_uncompressed_bytes=max_uncompressed_bytes,
            )
            return [normalized_name for _, normalized_name in members[:preview_limit]]
    except zipfile.BadZipFile as exc:
        raise SourceArchiveError("The uploaded file is not a valid zip archive.") from exc


def extract_safe_zip(
    archive_path: Path,
    destination: Path,
    *,
    max_entries: int,
    max_uncompressed_bytes: int,
) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()

    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = _iter_source_members(
                archive,
                max_entries=max_entries,
                max_uncompressed_bytes=max_uncompressed_bytes,
            )

            for info, normalized_name in members:
                target = destination / normalized_name
                resolved_target = target.resolve(strict=False)
                if destination_root != resolved_target and destination_root not in resolved_target.parents:
                    raise SourceArchiveError(
                        "The uploaded zip contains an unsafe file path.",
                        filename=info.filename,
                    )

                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue

                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
    except zipfile.BadZipFile as exc:
        raise SourceArchiveError("The uploaded file is not a valid zip archive.") from exc
