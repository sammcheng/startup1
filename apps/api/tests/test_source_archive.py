import io
import stat
import zipfile

import pytest

from app.services.source_archive import SourceArchiveError, extract_safe_zip, list_safe_zip_entries


def _zip_bytes(entries: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _symlink_zip_bytes(name: str = "app-link") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        info = zipfile.ZipInfo(name)
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, "target")
    return buffer.getvalue()


def test_list_safe_zip_entries_normalizes_backslash_paths() -> None:
    entries = list_safe_zip_entries(
        _zip_bytes({"src\\app.py": "print('ok')"}),
        max_entries=10,
        max_uncompressed_bytes=1024,
    )

    assert entries == ["src/app.py"]


@pytest.mark.parametrize(
    "filename",
    [
        "../secrets.env",
        "src/../../secrets.env",
        "/tmp/secrets.env",
        "\\tmp\\secrets.env",
        "C:\\tmp\\secrets.env",
        "src\\..\\secrets.env",
    ],
)
def test_list_safe_zip_entries_rejects_unsafe_paths(filename: str) -> None:
    with pytest.raises(SourceArchiveError, match="unsafe file path"):
        list_safe_zip_entries(
            _zip_bytes({filename: "nope"}),
            max_entries=10,
            max_uncompressed_bytes=1024,
        )


def test_list_safe_zip_entries_rejects_symlinks() -> None:
    with pytest.raises(SourceArchiveError, match="symbolic link"):
        list_safe_zip_entries(
            _symlink_zip_bytes(),
            max_entries=10,
            max_uncompressed_bytes=1024,
        )


def test_list_safe_zip_entries_rejects_duplicate_normalized_paths() -> None:
    with pytest.raises(SourceArchiveError, match="duplicate file paths"):
        list_safe_zip_entries(
            _zip_bytes({"src/app.py": "one", "src\\app.py": "two"}),
            max_entries=10,
            max_uncompressed_bytes=1024,
        )


def test_extract_safe_zip_rejects_symlinks_without_writing(tmp_path) -> None:
    archive_path = tmp_path / "source.zip"
    archive_path.write_bytes(_symlink_zip_bytes("app.py"))
    destination = tmp_path / "source"

    with pytest.raises(SourceArchiveError, match="symbolic link"):
        extract_safe_zip(
            archive_path,
            destination,
            max_entries=10,
            max_uncompressed_bytes=1024,
        )

    assert not (destination / "app.py").exists()
