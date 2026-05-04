"""StubEmbedder unit tests."""

from __future__ import annotations

from codesoul_model_server.embedder import StubEmbedder


def test_reports_identity() -> None:
    e = StubEmbedder(model_id="foo", model_revision="v1", dimension=8)
    assert e.model_id == "foo"
    assert e.model_revision == "v1"
    assert e.dimension == 8


def test_returns_vectors_of_configured_dimension() -> None:
    e = StubEmbedder(dimension=16)
    [vec] = e.embed(["hello"])
    assert len(vec) == 16


def test_values_are_in_minus_one_to_one_range() -> None:
    e = StubEmbedder(dimension=64)
    [vec] = e.embed(["hello"])
    assert all(-1.0 <= v <= 1.0 for v in vec)


def test_is_deterministic_on_identical_input() -> None:
    e = StubEmbedder(dimension=32)
    [a] = e.embed(["hello"])
    [b] = e.embed(["hello"])
    assert a == b


def test_differs_across_distinct_inputs() -> None:
    e = StubEmbedder(dimension=32)
    [a] = e.embed(["hello"])
    [b] = e.embed(["world"])
    assert a != b


def test_returns_one_vector_per_input_in_order() -> None:
    e = StubEmbedder(dimension=8)
    out = e.embed(["a", "b", "c"])
    assert len(out) == 3
    assert all(len(v) == 8 for v in out)
    # Order preserved.
    assert out[0] != out[1]
    assert out[1] != out[2]
