"""Vercel Python entrypoint for the Veyrona FastAPI application."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.main import app as _app  # noqa: E402


class StripApiPrefixMiddleware:
    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http" and scope.get("path", "").startswith("/api"):
            path = scope["path"]
            if path == "/api":
                scope = dict(scope, path="/")
            else:
                scope = dict(scope, path=path[4:] or "/")
        await _app(scope, receive, send)


app = StripApiPrefixMiddleware()
