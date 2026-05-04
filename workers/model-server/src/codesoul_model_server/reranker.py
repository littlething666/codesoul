"""Reranker protocol + stub backend.

The stub uses Jaccard similarity over whitespace-split tokens so tests
get a real ranking signal without loading a Qwen3-Reranker checkpoint.
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
    lands in a follow-up under the ``models`` extra.
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
