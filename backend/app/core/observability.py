import logging
import sys
import time
import uuid

import structlog
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "Latency by endpoint",
    ["method", "path", "status"],
)
ALLOCATIONS_TOTAL = Gauge("allocations_total", "Number of allocations in the DB")
BACKUP_LAST_SUCCESS = Gauge(
    "backup_last_success_timestamp", "Unix time of the last successful backup"
)
REQUESTS_TOTAL = Counter("http_requests_total", "Total requests", ["method", "status"])


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(stream=sys.stdout, level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
    )


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        try:
            response: Response = await call_next(request)
        finally:
            structlog.contextvars.clear_contextvars()
        elapsed = time.perf_counter() - start
        path = request.scope.get("route").path if request.scope.get("route") else request.url.path
        REQUEST_LATENCY.labels(request.method, path, response.status_code).observe(elapsed)
        REQUESTS_TOTAL.labels(request.method, response.status_code).inc()
        response.headers["x-request-id"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "font-src 'self' data:; script-src 'self'",
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if request.url.scheme == "https":
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response


def metrics_response() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
