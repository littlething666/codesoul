"""Shared pytest fixtures."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from codesoul_model_server.api import create_app
from codesoul_model_server.config import Settings


@pytest.fixture()
def settings() -> Settings:
    return Settings(
        embedder_model_id="stub-embedder",
        embedder_model_revision="0",
        embedder_dimension=1024,
        reranker_model_id="stub-reranker",
        reranker_model_revision="0",
    )


@pytest.fixture()
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))
