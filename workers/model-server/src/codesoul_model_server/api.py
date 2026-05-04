"""FastAPI app factory.

``create_app`` wires the configured embedder and reranker backends into a
fresh FastAPI instance. Tests pass an explicit ``Settings`` so each test
starts from a clean state.
"""

from __future__ import annotations

from fastapi import FastAPI

from .config import Settings
from .embedder import Embedder, StubEmbedder
from .reranker import Reranker, StubReranker
from .schemas import (
    EmbeddingItem,
    EmbedRequest,
    EmbedResponse,
    HealthBackend,
    HealthResponse,
    RerankRequest,
    RerankResponse,
    RerankScore,
)


def _build_embedder(settings: Settings) -> Embedder:
    if settings.embedder_backend == "stub":
        return StubEmbedder(
            model_id=settings.embedder_model_id,
            model_revision=settings.embedder_model_revision,
            dimension=settings.embedder_dimension,
        )
    raise NotImplementedError(
        f"unknown embedder backend: {settings.embedder_backend}"
    )


def _build_reranker(settings: Settings) -> Reranker:
    if settings.reranker_backend == "stub":
        return StubReranker(
            model_id=settings.reranker_model_id,
            model_revision=settings.reranker_model_revision,
        )
    raise NotImplementedError(
        f"unknown reranker backend: {settings.reranker_backend}"
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build a FastAPI app from the supplied (or env-derived) settings."""

    settings = settings or Settings()  # type: ignore[call-arg]
    embedder = _build_embedder(settings)
    reranker = _build_reranker(settings)

    app = FastAPI(
        title="codesoul-model-server",
        version="0.0.0",
        description=(
            "FastAPI model server for the @codesoul/embedder-http and "
            "@codesoul/reranker-http TS adapters."
        ),
    )

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            ok=True,
            embedder=HealthBackend(
                backend=settings.embedder_backend,
                modelId=embedder.model_id,
                modelRevision=embedder.model_revision,
            ),
            reranker=HealthBackend(
                backend=settings.reranker_backend,
                modelId=reranker.model_id,
                modelRevision=reranker.model_revision,
            ),
        )

    @app.post("/embed", response_model=EmbedResponse)
    def embed(request: EmbedRequest) -> EmbedResponse:
        # The server always echoes its OWN identity. Identity validation
        # is the client's job; mismatched modelId / modelRevision /
        # dimension surface as EmbeddingCompatibilityError on the TS side.
        texts = [item.text for item in request.inputs]
        vectors = embedder.embed(texts)
        return EmbedResponse(
            modelId=embedder.model_id,
            modelRevision=embedder.model_revision,
            dimension=embedder.dimension,
            embeddings=[EmbeddingItem(vector=v) for v in vectors],
        )

    @app.post("/rerank", response_model=RerankResponse)
    def rerank(request: RerankRequest) -> RerankResponse:
        texts = [c.text for c in request.candidates]
        scores = reranker.rerank(request.query, texts)
        return RerankResponse(
            modelId=reranker.model_id,
            modelRevision=reranker.model_revision,
            scores=[RerankScore(score=s) for s in scores],
        )

    return app
