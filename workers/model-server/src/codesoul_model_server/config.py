"""Runtime configuration via ``pydantic-settings``.

All values are sourced from environment variables prefixed with
``CODESOUL_MODEL_SERVER_``. A ``.env`` file in the working directory is
also honored to make local dev painless.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Top-level server settings."""

    model_config = SettingsConfigDict(
        env_prefix="CODESOUL_MODEL_SERVER_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # uvicorn
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: Literal["trace", "debug", "info", "warning", "error", "critical"] = (
        "info"
    )

    # Embedder identity (echoed in /embed responses; clients validate).
    embedder_backend: Literal["stub"] = "stub"
    embedder_model_id: str = "stub-embedder"
    embedder_model_revision: str = "0"
    embedder_dimension: int = Field(default=1024, ge=1)

    # Reranker identity (echoed in /rerank responses; clients validate).
    reranker_backend: Literal["stub"] = "stub"
    reranker_model_id: str = "stub-reranker"
    reranker_model_revision: str = "0"
