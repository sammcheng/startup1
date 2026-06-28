import pytest

from app.exceptions import AppError
from app.services import url_safety


def _dns_record(address: str):
    return (url_safety.socket.AF_INET, url_safety.socket.SOCK_STREAM, 6, "", (address, 443))


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
    monkeypatch.setattr(url_safety.socket, "getaddrinfo", lambda *args, **kwargs: [_dns_record("93.184.216.34")])

    assert url_safety.validate_public_tool_endpoint("https://tool.example.com/api/") == "https://tool.example.com/api"


def test_public_tool_endpoint_rejects_hostname_that_resolves_to_private_ip(monkeypatch):
    monkeypatch.setattr(url_safety.settings, "environment", "production")
    monkeypatch.setattr(url_safety.socket, "getaddrinfo", lambda *args, **kwargs: [_dns_record("10.0.0.12")])

    with pytest.raises(AppError) as exc:
        url_safety.validate_public_tool_endpoint("https://tool.example.com/api")

    assert exc.value.error_code == "unsafe_deployment_url"


def test_public_tool_endpoint_rejects_mixed_public_and_private_dns_answers(monkeypatch):
    monkeypatch.setattr(url_safety.settings, "environment", "production")
    monkeypatch.setattr(
        url_safety.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [_dns_record("93.184.216.34"), _dns_record("127.0.0.1")],
    )

    with pytest.raises(AppError) as exc:
        url_safety.validate_public_tool_endpoint("https://tool.example.com")

    assert exc.value.error_code == "unsafe_deployment_url"


def test_public_tool_endpoint_rejects_unresolvable_production_hostname(monkeypatch):
    monkeypatch.setattr(url_safety.settings, "environment", "production")

    def fail_dns(*args, **kwargs):
        raise url_safety.socket.gaierror("not found")

    monkeypatch.setattr(url_safety.socket, "getaddrinfo", fail_dns)

    with pytest.raises(AppError) as exc:
        url_safety.validate_public_tool_endpoint("https://missing.example.com")

    assert exc.value.error_code == "deployment_dns_unresolved"


@pytest.mark.asyncio
async def test_async_public_tool_endpoint_rejects_private_dns_answers(monkeypatch):
    monkeypatch.setattr(url_safety.settings, "environment", "production")
    monkeypatch.setattr(url_safety.socket, "getaddrinfo", lambda *args, **kwargs: [_dns_record("192.168.1.10")])

    with pytest.raises(AppError) as exc:
        await url_safety.validate_public_tool_endpoint_async("https://tool.example.com")

    assert exc.value.error_code == "unsafe_deployment_url"
