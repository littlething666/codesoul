"""FastAPI model server for the @codesoul/embedder-http and @codesoul/reranker-http TS adapters.

The wire contract is the source of truth; see README.md for shape and
`schemas.py` for the Pydantic models that pin it.
"""

from .api import create_app
from .config import Settings

__all__ = ["Settings", "create_app"]
