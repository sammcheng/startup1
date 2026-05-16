from redis.asyncio import Redis


class PortManager:
    def __init__(
        self,
        redis: Redis,
        *,
        start_port: int = 9000,
        end_port: int = 9999,
        redis_key: str = "ports:allocated",
    ) -> None:
        self.redis = redis
        self.start_port = start_port
        self.end_port = end_port
        self.redis_key = redis_key

    async def allocate(self) -> int:
        for port in range(self.start_port, self.end_port + 1):
            added = await self.redis.sadd(self.redis_key, port)
            if added:
                return port
        raise RuntimeError("No available ports in the configured allocation range.")

    async def release(self, port: int) -> None:
        await self.redis.srem(self.redis_key, port)

    async def is_allocated(self, port: int) -> bool:
        return bool(await self.redis.sismember(self.redis_key, port))
