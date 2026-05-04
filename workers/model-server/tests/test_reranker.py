"""StubReranker unit tests."""

from __future__ import annotations

from codesoul_model_server.reranker import StubReranker


def test_reports_identity() -> None:
    r = StubReranker(model_id="rr", model_revision="v1")
    assert r.model_id == "rr"
    assert r.model_revision == "v1"


def test_empty_candidates_returns_empty_list() -> None:
    r = StubReranker()
    assert r.rerank("q", []) == []


def test_score_count_matches_candidate_count() -> None:
    r = StubReranker()
    scores = r.rerank("q", ["a", "b", "c"])
    assert len(scores) == 3


def test_jaccard_similarity_orders_better_matches_higher() -> None:
    r = StubReranker()
    scores = r.rerank(
        "greet user",
        ["greet user warmly", "unrelated content here"],
    )
    assert scores[0] > scores[1]


def test_perfect_match_scores_one() -> None:
    r = StubReranker()
    [score] = r.rerank("hello", ["hello"])
    assert score == 1.0


def test_no_overlap_scores_zero() -> None:
    r = StubReranker()
    [score] = r.rerank("alpha", ["beta"])
    assert score == 0.0
