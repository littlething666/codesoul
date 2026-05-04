"""Reranker protocol + backends.

The stub backend uses Jaccard similarity over whitespace tokens so tests
get a real ranking signal without loading a Qwen3-Reranker checkpoint.

The sentence-transformers CrossEncoder backend runs
Qwen/Qwen3-Reranker-0.6B behind the optional ``models`` extra. The
planning doc explicitly notes that Qwen3-Reranker-0.6B supports the
CrossEncoder interface; a vLLM-served variant can be added as a parallel
backend without changing the contract.
"""

from __future__ import annotations

from typing import Protocol


class Reranker(Protocol):
    model_id: str
    model_revision: str

    def rerank(self, query: str, candidates: list[str]) -> list[float]: ...


class StubReranker:
    """Jaccard-similarity reranker over whitespace tokens.

    Order-preserving and deterministic. Real Qwen3-Reranker integration
    runs through ``SentenceTransformersReranker`` under the ``models``
    extra.
    """

    def __init__(
        self,
        model_id: str = "stub-reranker",
        model_revision: str = "0",
    ) -> None:
        self.model_id = model_id
        self.model_revision = model_revision

    def rerank(self, query: str, candidates: list[str]) -> list[float]:
        q_tokens = set(query.lower().split())
        scores: list[float] = []
        for c in candidates:
            c_tokens = set(c.lower().split())
            union = q_tokens | c_tokens
            if not union:
                scores.append(0.0)
                continue
            intersection = q_tokens & c_tokens
            scores.append(len(intersection) / len(union))
        return scores


class SentenceTransformersReranker:
    """sentence-transformers CrossEncoder reranker for Qwen/Qwen3-Reranker-0.6B.

    Lazy-imports the CrossEncoder so importing this module does not
    require the ``models`` extra. The HF revision must be a concrete
    commit SHA; floating revisions are rejected at construction time.
    """

    def __init__(
        self,
        *,
        model_id: str,
        model_revision: str,
        device: str | None = None,
    ) -> None:
        if not model_revision or model_revision == "0":
            raise ValueError(
                "sentence-transformers reranker requires a concrete HF revision SHA "
                "(set CODESOUL_MODEL_SERVER_RERANKER_MODEL_REVISION); "
                f"got {model_revision!r}",
            )
        try:
            from sentence_transformers import CrossEncoder
        except ModuleNotFoundError as err:
            raise ModuleNotFoundError(
                "sentence-transformers is not installed. "
                "Install the 'models' extra: pip install -e .[models]",
            ) from err
        self.model_id = model_id
        self.model_revision = model_revision
        self._model = CrossEncoder(
            model_id,
            revision=model_revision,
            device=device,
        )

    def rerank(self, query: str, candidates: list[str]) -> list[float]:
        if not candidates:
            return []
        pairs = [(query, c) for c in candidates]
        # CrossEncoder.predict returns either a numpy array or a Python
        # list depending on version; normalize to list[float] so the
        # wire-contract response stays stable.
        scores = self._model.predict(pairs, convert_to_numpy=True)
        return [float(s) for s in scores.tolist()]
