import pytest

from app.exceptions import AppError
from app.services import url_safety


def test_public_tool_endpoint_allows_local_urls_outside_production(monkeypatch):
    monkeypatch.setattr(url_safety.settings, "environment", "development")

    assert url_safety.validate_public_tool_endpoint("http://localhost:8080/api/") == "http://localhost:8080/api"


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://api.example.com",
        "https://localhost:8080",
        "https://127.0.0.1:8080",
        "https://10.0.0.5",
        "https://172.16.1.2",
        "https://192.168.1.2",
        "https://169.254.169.254",
        "https://metadata.google.internal",
        "https://service.internal",
        "https://tool.local",
    ],
)
def test_public_tool_endpoint_rejects_unsafe_production_urls(endpoint, monkeypatch):
    monkeypatch.setattr(url_safety.settings, "environment", "production")

    with pytest.raises(AppError) as exc:
        url_safety.validate_public_tool_endpoint(endpoint)

    assert exc.value.error_code in {"insecure_deployment_url", "unsafe_deployment_url"}


def test_public_tool_endpoint_allows_public_https_in_production(monkeypatch):
    monkeypatch.setattr(url_safety.settings, "environment", "production")

    assert url_safety.validate_public_tool_endpoint("https://tool.example.com/api/") == "https://tool.example.com/api"
