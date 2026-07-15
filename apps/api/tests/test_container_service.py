import io
import stat
import zipfile

import pytest

from app.services import container_service, storage_service
from app.services.container_service import (
    ContainerBuilder,
    ContainerBuildError,
    ProjectAnalysis,
)


def _symlink_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        info = zipfile.ZipInfo("app.py")
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, "target")
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_prepare_source_rejects_stored_zip_symlinks(draft_tool, tmp_path, monkeypatch):
    draft_tool.source_s3_key = f"tools/{draft_tool.id}/source.zip"

    async def fake_download_bytes(key):
        assert key == draft_tool.source_s3_key
        return _symlink_zip_bytes()

    monkeypatch.setattr(storage_service, "download_bytes", fake_download_bytes)

    with pytest.raises(ContainerBuildError, match="symbolic link"):
        await ContainerBuilder()._prepare_source(draft_tool, str(tmp_path))

    assert not (tmp_path / "source" / "app.py").exists()


def test_container_service_uses_safe_zip_extractor() -> None:
    source = container_service.Path(container_service.__file__).read_text(encoding="utf-8")

    assert "extract_safe_zip" in source
    assert "extractall" not in source
    assert "unpack_archive" not in source


def test_runtime_configuration_infers_entry_command_and_port(draft_tool):
    draft_tool.entry_command = None
    draft_tool.port = 8080
    analysis = ProjectAnalysis(
        source_path="/tmp/tool",
        language="python",
        framework="fastapi",
        entry_point="main.py",
        port=9000,
        dependencies_file="requirements.txt",
        has_dockerfile=False,
    )

    config = ContainerBuilder()._tool_config_from_tool(draft_tool, analysis)

    assert config.entry_command == "python main.py"
    assert config.port == 9000
