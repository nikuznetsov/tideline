import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    """Simple in-memory rate limiter. Good enough for a single instance.

    Keys are evicted once their window has expired, so the dict does not grow
    without bound from internet traffic on public endpoints."""

    # how often to sweep all keys and drop the stale ones
    _SWEEP_EVERY = 1000

    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._since_sweep = 0

    def check(self, key: str) -> bool:
        now = time.monotonic()
        self._since_sweep += 1
        if self._since_sweep >= self._SWEEP_EVERY:
            self._sweep(now)
        hits = self._hits[key]
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        if len(hits) >= self.max_requests:
            return False
        hits.append(now)
        return True

    def _sweep(self, now: float) -> None:
        """Periodic cleanup: drop keys whose hits have all expired."""
        self._since_sweep = 0
        cutoff = now - self.window
        stale = [k for k, h in self._hits.items() if not h or h[-1] <= cutoff]
        for k in stale:
            del self._hits[k]


login_limiter = SlidingWindowLimiter(max_requests=10, window_seconds=60)
share_limiter = SlidingWindowLimiter(max_requests=120, window_seconds=60)


def client_ip(request: Request) -> str:
    # X-Forwarded-For: client, proxy1, ..., trusted-proxy. The client can forge
    # the leftmost values (to bypass the brute-force limit), so we take the
    # rightmost one — appended by our own proxy, which sees the real address.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def enforce(limiter: SlidingWindowLimiter, request: Request) -> None:
    if not limiter.check(client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests")
