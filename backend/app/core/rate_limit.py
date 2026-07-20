import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    """Простой in-memory rate limiter. Достаточно для одного инстанса."""

    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        if len(hits) >= self.max_requests:
            return False
        hits.append(now)
        return True


login_limiter = SlidingWindowLimiter(max_requests=10, window_seconds=60)
share_limiter = SlidingWindowLimiter(max_requests=120, window_seconds=60)


def client_ip(request: Request) -> str:
    # X-Forwarded-For: client, proxy1, ..., trusted-proxy. Левые значения клиент
    # может подделать (обход лимита брутфорса), поэтому берём правое — его
    # добавляет наш прокси (Railway) и видит реальный адрес.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def enforce(limiter: SlidingWindowLimiter, request: Request) -> None:
    if not limiter.check(client_ip(request)):
        raise HTTPException(status_code=429, detail="Слишком много запросов")
