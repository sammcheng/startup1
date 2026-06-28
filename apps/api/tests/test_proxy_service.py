from app.services import proxy_service


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
