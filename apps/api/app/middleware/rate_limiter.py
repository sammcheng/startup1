from fastapi import HTTPException, status
from redis.asyncio import Redis


async def check_rate_limit(
    redis: Redis,
    key: str,
    limit: int,
    window: int = 60,
) -> None:
    """
    Increment a Redis counter for *key* and raise HTTP 429 when *limit* is
    exceeded within *window* seconds.

    Uses Redis INCR + EXPIRE so the window resets after the TTL expires.
    Call this from any route dependency or handler:

        await check_rate_limit(redis, f"user:{user.id}", limit=100, window=60)
    """
    redis_key = f"rl:{key}"
    count: int = await redis.incr(redis_key)
    if count == 1:
        # First request in this window — set the TTL
        await redis.expire(redis_key, window)
    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RATE_LIMIT_EXCEEDED",
                "message": "Too many requests. Please slow down.",
                "details": {"limit": limit, "window_seconds": window},
            },
        )
