"""Wire-level request / response schemas.

These must match exactly what ``@codesoul/embedder-http`` and
``@codesoul/reranker-http`` send and expect. We use camelCase field names
intentionally because this is the JSON-over-HTTP boundary, not Python
internal code; PEP 8 doesn't apply to wire shapes.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# --- Embed -----------------------------------------------------------------


class _Strict(BaseModel):
    """Reject unknown fields so contract drift is caught immediately."""

    model_config = ConfigDict(extra="forbid")


class EmbedNodeInput(_Strict):
    kind: Literal["node"]
    nodeId: str = Field(min_length=1)
    contentHash: str = Field(min_length=1)
    payloadKind: Literal["FunctionSummary", "Block", "Markdown"]
    text: str


class EmbedQueryInput(_Strict):
    kind: Literal["query"]
    queryId: str = Field(min_length=1)
    text: str


EmbedInput = Annotated[
    EmbedNodeInput | EmbedQueryInput,
    Field(discriminator="kind"),
]


class EmbedRequest(_Strict):
    modelId: str = Field(min_length=1)
    modelRevision: str = Field(min_length=1)
    dimension: int = Field(ge=1)
    inputs: list[EmbedInput]


class EmbeddingItem(BaseModel):
    vector: list[float]


class EmbedResponse(BaseModel):
    modelId: str
    modelRevision: str
    dimension: int
    embeddings: list[EmbeddingItem]


# --- Rerank ----------------------------------------------------------------


class RerankCandidate(_Strict):
    nodeId: str = Field(min_length=1)
    text: str


class RerankRequest(_Strict):
    modelId: str = Field(min_length=1)
    modelRevision: str = Field(min_length=1)
    query: str
    candidates: list[RerankCandidate]


class RerankScore(BaseModel):
    score: float


class RerankResponse(BaseModel):
    modelId: str
    modelRevision: str
    scores: list[RerankScore]


# --- Health ----------------------------------------------------------------


class HealthBackend(BaseModel):
    backend: str
    modelId: str
    modelRevision: str


class HealthResponse(BaseModel):
    ok: bool
    embedder: HealthBackend
    reranker: HealthBackend
