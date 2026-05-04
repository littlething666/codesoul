"""uvicorn entry point.

Usage:

    codesoul-model-server

Reads ``CODESOUL_MODEL_SERVER_*`` env vars (or a .env file in the working
directory) for host, port, and backend selection.
"""

from __future__ import annotations

import uvicorn

from .api import create_app
from .config import Settings


def main() -> None:
    settings = Settings()  # type: ignore[call-arg]
    app = create_app(settings)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
