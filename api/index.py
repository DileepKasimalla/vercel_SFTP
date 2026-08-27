"""Vercel serverless entrypoint.

Vercel only turns Python files under `api/` into serverless functions, so this
thin shim is the one function; the application itself lives in `backend/`,
which is pulled into the bundle by the `includeFiles` setting in vercel.json.
"""
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from backend.main import app  # noqa: E402

__all__ = ["app"]
