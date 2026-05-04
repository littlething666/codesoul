"""Embedder protocol + backends.

The stub backend is deterministic (SHA-256 driven) and intentionally
mirrors the JS ``MockEmbedder`` algorithm so a future cross-language
conformance test can compare vectors byte-for-byte.

The sentence-transformers backend runs Qwen/Qwen3-Embedding-0.6B (1024-dim)
behind the optional ``models`` extra. Real model loads happen at
construction time so misconfiguration fails closed before serving traffic.
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


class SentenceTransformersEmbedder:
    """sentence-transformers-backed embedder for Qwen/Qwen3-Embedding-0.6B.

    Loaded lazily so importing this module does not require the
    ``models`` extra (``sentence-transformers``, ``transformers``,
    ``torch``) to be installed. Operators who configure
    ``embedder_backend = "sentence-transformers"`` MUST install the extra
    or construction fails with a clear ``ModuleNotFoundError``.

    The HF revision must be a concrete commit SHA, not a branch or tag —
    floating revisions defeat reproducibility. See the planning doc's
    \"Model revision pinning\" guardrail.
    """

    def __init__(
        self,
        *,
        model_id: str,
        model_revision: str,
        dimension: int,
        device: str | None = None,
    ) -> None:
        if not model_revision or model_revision == "0":
            raise ValueError(
                "sentence-transformers embedder requires a concrete HF revision SHA "
                "(set CODESOUL_MODEL_SERVER_EMBEDDER_MODEL_REVISION); "
                f"got {model_revision!r}",
            )
        try:
            from sentence_transformers import SentenceTransformer
        except ModuleNotFoundError as err:
            raise ModuleNotFoundError(
                "sentence-transformers is not installed. "
                "Install the 'models' extra: pip install -e .[models]",
            ) from err
        self.model_id = model_id
        self.model_revision = model_revision
        self.dimension = dimension
        self._model = SentenceTransformer(
            model_id,
            revision=model_revision,
            device=device,
        )
        actual_dim = int(self._model.get_sentence_embedding_dimension() or 0)
        if actual_dim != dimension:
            raise ValueError(
                f"model dimension mismatch: configured {dimension}, "
                f"loaded model reports {actual_dim}",
            )

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        # convert_to_numpy returns a (N, D) float32 array; tolist() yields
        # nested Python lists matching the wire-contract response shape.
        # normalize_embeddings keeps cosine search stable across batches.
        vectors = self._model.encode(
            texts,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        return vectors.tolist()
