from types import SimpleNamespace

from app.services import proxy_service
from app.services.gateway_signing import sign_gateway_request

TEST_GATEWAY_PRIVATE_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"


def test_filter_request_headers_strips_platform_and_user_credentials():
    headers = {
        "Authorization": "Bearer clerk-session",
        "Cookie": "session=secret",
        "X-API-Key": "hm_live_secret",
        "X-Forwarded-For": "203.0.113.10",
        "X-Forwarded-Host": "app.example.com",
        "X-Forwarded-Proto": "https",
        "X-Real-IP": "203.0.113.11",
        "Forwarded": "for=203.0.113.10;proto=https",
        "Host": "api.hackmarket.example",
        "Content-Length": "42",
        "Connection": "keep-alive",
        "Content-Type": "application/json",
        "X-Client-Trace": "safe-to-forward",
        "X-HackMarket-Signature": "forged-signature",
        "X-HackMarket-Signature-Version": "ed25519-v1",
        "X-HackMarket-Signature-Key-Id": "attacker-key",
        "X-HackMarket-Signature-Timestamp": "1800000000",
        "X-HackMarket-Request-Id": "forged-request-id",
        "X-HackMarket-Tool-Slug": "another-tool",
    }

    filtered = proxy_service.filter_request_headers(headers)

    assert filtered == {
        "Content-Type": "application/json",
        "X-Client-Trace": "safe-to-forward",
    }


def test_filter_request_headers_can_keep_api_key_only_when_explicitly_requested():
    filtered = proxy_service.filter_request_headers(
        {
            "Authorization": "Bearer user-session",
            "Cookie": "session=secret",
            "X-API-Key": "hm_live_secret",
        },
        strip_api_key=False,
    )

    assert filtered == {"X-API-Key": "hm_live_secret"}


def test_filter_response_headers_strips_cookie_and_hop_by_hop_headers():
    filtered = proxy_service.filter_response_headers(
        {
            "Set-Cookie": "seller_session=secret; Path=/",
            "Connection": "keep-alive",
            "Transfer-Encoding": "chunked",
            "Content-Length": "24",
            "Content-Type": "application/json",
            "X-Seller-Trace": "safe-to-return",
        }
    )

    assert filtered == {
        "Content-Type": "application/json",
        "X-Seller-Trace": "safe-to-return",
    }


async def test_forward_request_replaces_forged_internal_headers_with_platform_signature(
    monkeypatch,
):
    captured = {}

    class FakeClient:
        async def request(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(status_code=200)

    async def allow_endpoint(_url):
        return None

    request = SimpleNamespace(
        method="POST",
        url=SimpleNamespace(query="mode=full%20scan"),
        headers={
            "Content-Type": "application/json",
            "X-HackMarket-Signature": "forged",
            "X-HackMarket-Request-Id": "forged-request-id",
        },
    )
    monkeypatch.setattr(proxy_service, "get_http_client", lambda: FakeClient())
    monkeypatch.setattr(proxy_service, "validate_public_tool_endpoint_async", allow_endpoint)
    monkeypatch.setattr(
        proxy_service.settings,
        "tool_gateway_signing_private_key",
        TEST_GATEWAY_PRIVATE_KEY,
    )
    monkeypatch.setattr(proxy_service.settings, "tool_gateway_signing_key_id", "launch-1")
    monkeypatch.setattr(proxy_service.gateway_signing.time, "time", lambda: 1_800_000_000)

    await proxy_service.forward_request(
        api_endpoint="https://seller.example.com/api",
        request=request,
        request_body=b'{"images":[]}',
        request_id="req-platform-123",
        tool_slug="home-accessibility-checker",
        tool_path="analyze",
        extra_headers={"X-HackMarket-Tool-Slug": "forged-tool"},
    )

    expected_signature_headers = sign_gateway_request(
        method="POST",
        request_target="/api/analyze?mode=full%20scan",
        request_id="req-platform-123",
        tool_slug="home-accessibility-checker",
        encoded_private_key=TEST_GATEWAY_PRIVATE_KEY,
        key_id="launch-1",
        timestamp=1_800_000_000,
    )
    assert {
        key: captured["headers"][key] for key in expected_signature_headers
    } == expected_signature_headers
    assert captured["headers"]["X-HackMarket-Request-Id"] == "req-platform-123"
    assert captured["headers"]["X-HackMarket-Tool-Slug"] == "home-accessibility-checker"
    assert captured["headers"]["X-HackMarket-Signature"] != "forged"
