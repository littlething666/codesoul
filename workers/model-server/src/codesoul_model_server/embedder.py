"""Embedder protocol + stub backend.

The stub backend is deterministic (SHA-256 driven) and intentionally
mirrors the JS ``MockEmbedder`` algorithm so a future cross-language
conformance test can compare vectors byte-for-byte.
"""

from __future__ import annotations

import hashlib
from typing import Protocol


class Embedder(Protocol):
    """Pluggable embedder backend.

    Real implementations (sentence-transformers + Qwen3-Embedding-0.6B,
    or a vLLM-served variant) plug in here without changing the API.
    """

    model_id: str
    model_revision: str
    dimension: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


def _value_at(text: str, i: int) -> float:
    h = hashlib.sha256()
    h.update(text.encode("utf-8"))
    h.update(b"\x00")
    h.update(str(i).encode("utf-8"))
    n = int.from_bytes(h.digest()[:4], "big", signed=False)
    return (n / 0xFFFFFFFF) * 2 - 1


class StubEmbedder:
    """Deterministic hash-based embedder. No GPU, no model download.

    Mirrors ``MockEmbedder.valueAt`` from the JS side so cross-language
    conformance tests can verify the contract end-to-end without loading
    real weights.
    """

    def __init__(
        self,
        model_id: str = "stub-embedder",
        model_revision: str = "0",
        dimension: int = 1024,
    ) -> None:
        self.model_id = model_id
        self.model_revision = model_revision
        self.dimension = dimension

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [
            [_value_at(text, i) for i in range(self.dimension)] for text in texts
        ]
