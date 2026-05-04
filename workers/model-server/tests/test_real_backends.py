"""Tests for the sentence-transformers backends.

These tests focus on the configuration / wiring surface, not on real
model loading: torch is multi-GB and CI does not install the ``models``
extra by default. Coverage:

  - Bare module imports succeed without torch (lazy imports).
  - Construction without the extra raises a clear ``ModuleNotFoundError``
    with the remediation message in it.
  - A placeholder/empty HF revision is rejected before any model load.
  - Settings accept the new backend literal and reject unknown values.
  - An opt-in real-load smoke runs only when both the ``models`` extra
    is installed AND ``CODESOUL_MODELS_SMOKE`` is set; this gates the
    multi-GB Qwen3 download behind an explicit operator decision.
"""

from __future__ import annotations

import importlib
import os

import pytest

from codesoul_model_server.config import Settings


def _has_models_extra() -> bool:
    try:
        importlib.import_module("sentence_transformers")
    except ModuleNotFoundError:
        return False
    return True


# --- Lazy-import smoke (always runs) ---------------------------------------


def test_embedder_module_imports_without_models_extra() -> None:
    """The bare module surface must be importable without torch."""

    module = importlib.import_module("codesoul_model_server.embedder")
    assert hasattr(module, "StubEmbedder")
    assert hasattr(module, "SentenceTransformersEmbedder")


def test_reranker_module_imports_without_models_extra() -> None:
    module = importlib.import_module("codesoul_model_server.reranker")
    assert hasattr(module, "StubReranker")
    assert hasattr(module, "SentenceTransformersReranker")


# --- Construction-without-extra failure mode -------------------------------


@pytest.mark.skipif(
    _has_models_extra(),
    reason="models extra is installed; use CODESOUL_MODELS_SMOKE for full path",
)
def test_sentence_transformers_embedder_raises_without_extra() -> None:
    from codesoul_model_server.embedder import SentenceTransformersEmbedder

    with pytest.raises(ModuleNotFoundError, match=r"models"):
        SentenceTransformersEmbedder(
            model_id="Qwen/Qwen3-Embedding-0.6B",
            model_revision="deadbeef" * 5,
            dimension=1024,
        )


@pytest.mark.skipif(
    _has_models_extra(),
    reason="models extra is installed; use CODESOUL_MODELS_SMOKE for full path",
)
def test_sentence_transformers_reranker_raises_without_extra() -> None:
    from codesoul_model_server.reranker import SentenceTransformersReranker

    with pytest.raises(ModuleNotFoundError, match=r"models"):
        SentenceTransformersReranker(
            model_id="Qwen/Qwen3-Reranker-0.6B",
            model_revision="deadbeef" * 5,
        )


# --- Revision validation (always runs; pure Python guard, no model load) ---


def test_sentence_transformers_embedder_rejects_placeholder_revision() -> None:
    from codesoul_model_server.embedder import SentenceTransformersEmbedder

    with pytest.raises(ValueError, match=r"revision SHA"):
        SentenceTransformersEmbedder(
            model_id="Qwen/Qwen3-Embedding-0.6B",
            model_revision="0",
            dimension=1024,
        )


def test_sentence_transformers_reranker_rejects_placeholder_revision() -> None:
    from codesoul_model_server.reranker import SentenceTransformersReranker

    with pytest.raises(ValueError, match=r"revision SHA"):
        SentenceTransformersReranker(
            model_id="Qwen/Qwen3-Reranker-0.6B",
            model_revision="0",
        )


def test_sentence_transformers_embedder_rejects_empty_revision() -> None:
    from codesoul_model_server.embedder import SentenceTransformersEmbedder

    with pytest.raises(ValueError, match=r"revision SHA"):
        SentenceTransformersEmbedder(
            model_id="Qwen/Qwen3-Embedding-0.6B",
            model_revision="",
            dimension=1024,
        )


# --- Settings can be configured for the new backend ------------------------


def test_settings_accept_sentence_transformers_backend() -> None:
    s = Settings(
        embedder_backend="sentence-transformers",
        embedder_model_id="Qwen/Qwen3-Embedding-0.6B",
        embedder_model_revision="abc123" * 7,
        reranker_backend="sentence-transformers",
        reranker_model_id="Qwen/Qwen3-Reranker-0.6B",
        reranker_model_revision="def456" * 7,
    )
    assert s.embedder_backend == "sentence-transformers"
    assert s.reranker_backend == "sentence-transformers"


def test_settings_forward_optional_device_hint() -> None:
    s = Settings(
        embedder_backend="sentence-transformers",
        embedder_model_revision="abc" * 14,
        embedder_device="cuda:0",
        reranker_device="cpu",
    )
    assert s.embedder_device == "cuda:0"
    assert s.reranker_device == "cpu"


def test_settings_reject_unknown_embedder_backend() -> None:
    with pytest.raises(Exception):
        Settings(embedder_backend="bogus")  # type: ignore[arg-type]


def test_settings_reject_unknown_reranker_backend() -> None:
    with pytest.raises(Exception):
        Settings(reranker_backend="bogus")  # type: ignore[arg-type]


# --- Real-backend smoke (opt-in only) --------------------------------------


@pytest.mark.skipif(
    not _has_models_extra() or not os.environ.get("CODESOUL_MODELS_SMOKE"),
    reason="set CODESOUL_MODELS_SMOKE=1 with the models extra to run",
)
def test_sentence_transformers_embedder_smoke() -> None:
    """Opt-in smoke that actually loads the real Qwen3 embedder.

    Requires both the ``models`` extra and the ``CODESOUL_MODELS_SMOKE=1``
    env var so the multi-GB download is never accidental.
    """

    from codesoul_model_server.embedder import SentenceTransformersEmbedder

    revision = os.environ.get("CODESOUL_QWEN3_EMBEDDING_REVISION")
    if not revision:
        pytest.skip("set CODESOUL_QWEN3_EMBEDDING_REVISION to a concrete HF SHA")

    embedder = SentenceTransformersEmbedder(
        model_id="Qwen/Qwen3-Embedding-0.6B",
        model_revision=revision,
        dimension=1024,
    )
    [vec] = embedder.embed(["hello"])
    assert len(vec) == 1024
    assert all(isinstance(v, float) for v in vec)
