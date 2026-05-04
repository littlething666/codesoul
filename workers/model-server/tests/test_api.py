"""FastAPI wire-contract tests.

These assert the JSON shapes that ``@codesoul/embedder-http`` and
``@codesoul/reranker-http`` send and expect. Any change here that breaks
the TS adapters' tests is a contract bug.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


SYM = "sym_" + "a" * 40
CNT = "cnt_" + "0" * 40


def _node_input(text: str = "hello") -> dict:
    return {
        "kind": "node",
        "nodeId": SYM,
        "contentHash": CNT,
        "payloadKind": "FunctionSummary",
        "text": text,
    }


def _query_input(text: str = "hello", query_id: str = "q1") -> dict:
    return {"kind": "query", "queryId": query_id, "text": text}


# --- /health ---------------------------------------------------------------


def test_health_returns_ok_and_backend_identity(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["embedder"]["backend"] == "stub"
    assert body["embedder"]["modelId"] == "stub-embedder"
    assert body["embedder"]["modelRevision"] == "0"
    assert body["reranker"]["backend"] == "stub"
    assert body["reranker"]["modelId"] == "stub-reranker"
    assert body["reranker"]["modelRevision"] == "0"


# --- /embed ----------------------------------------------------------------


def test_embed_round_trip_for_node_input(client: TestClient) -> None:
    response = client.post(
        "/embed",
        json={
            "modelId": "stub-embedder",
            "modelRevision": "0",
            "dimension": 1024,
            "inputs": [_node_input("hello")],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["modelId"] == "stub-embedder"
    assert body["modelRevision"] == "0"
    assert body["dimension"] == 1024
    assert len(body["embeddings"]) == 1
    assert len(body["embeddings"][0]["vector"]) == 1024


def test_embed_round_trip_for_query_input(client: TestClient) -> None:
    response = client.post(
        "/embed",
        json={
            "modelId": "stub-embedder",
            "modelRevision": "0",
            "dimension": 1024,
            "inputs": [_query_input("greet")],
        },
    )
    assert response.status_code == 200
    assert len(response.json()["embeddings"]) == 1


def test_embed_handles_mixed_inputs_in_order(client: TestClient) -> None:
    response = client.post(
        "/embed",
        json={
            "modelId": "stub-embedder",
            "modelRevision": "0",
            "dimension": 1024,
            "inputs": [
                _node_input("a"),
                _query_input("b", "q-b"),
                _node_input("c"),
            ],
        },
    )
    assert response.status_code == 200
    embeddings = response.json()["embeddings"]
    assert len(embeddings) == 3
    assert embeddings[0] != embeddings[1]
    assert embeddings[1] != embeddings[2]


def test_embed_empty_inputs_returns_empty_embeddings(client: TestClient) -> None:
    response = client.post(
        "/embed",
        json={
            "modelId": "stub-embedder",
            "modelRevision": "0",
            "dimension": 1024,
            "inputs": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["embeddings"] == []


def test_embed_is_deterministic(client: TestClient) -> None:
    payload = {
        "modelId": "stub-embedder",
        "modelRevision": "0",
        "dimension": 1024,
        "inputs": [_node_input("hello")],
    }
    a = client.post("/embed", json=payload).json()
    b = client.post("/embed", json=payload).json()
    assert a == b


def test_embed_echoes_server_identity_even_when_request_claims_other_identity(
    client: TestClient,
) -> None:
    """The server never lies about who it is. Mismatched-identity
    detection is the TS client's job (EmbeddingCompatibilityError)."""

    response = client.post(
        "/embed",
        json={
            "modelId": "some/other-embedder",
            "modelRevision": "v999",
            "dimension": 1024,
            "inputs": [_node_input("hello")],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["modelId"] == "stub-embedder"
    assert body["modelRevision"] == "0"


def test_embed_rejects_unknown_input_kind(client: TestClient) -> None:
    response = client.post(
        "/embed",
        json={
            "modelId": "stub-embedder",
            "modelRevision": "0",
            "dimension": 1024,
            "inputs": [{"kind": "bogus", "text": "x"}],
        },
    )
    assert response.status_code == 422


def test_embed_rejects_extra_fields(client: TestClient) -> None:
    response = client.post(
        "/embed",
        json={
            "modelId": "stub-embedder",
            "modelRevision": "0",
            "dimension": 1024,
            "inputs": [_node_input("hello")],
            "unknownField": "surprise",
        },
    )
    assert response.status_code == 422


# --- /rerank ---------------------------------------------------------------


def test_rerank_round_trip(client: TestClient) -> None:
    response = client.post(
        "/rerank",
        json={
            "modelId": "stub-reranker",
            "modelRevision": "0",
            "query": "greet user",
            "candidates": [
                {"nodeId": SYM, "text": "greet user warmly"},
                {"nodeId": SYM, "text": "unrelated content"},
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["modelId"] == "stub-reranker"
    assert body["modelRevision"] == "0"
    assert len(body["scores"]) == 2
    # Jaccard similarity should rank the overlapping candidate higher.
    assert body["scores"][0]["score"] > body["scores"][1]["score"]


def test_rerank_score_count_matches_candidate_count(client: TestClient) -> None:
    response = client.post(
        "/rerank",
        json={
            "modelId": "stub-reranker",
            "modelRevision": "0",
            "query": "q",
            "candidates": [
                {"nodeId": SYM, "text": "a"},
                {"nodeId": SYM, "text": "b"},
                {"nodeId": SYM, "text": "c"},
            ],
        },
    )
    assert response.status_code == 200
    assert len(response.json()["scores"]) == 3


def test_rerank_empty_candidates_returns_empty_scores(client: TestClient) -> None:
    response = client.post(
        "/rerank",
        json={
            "modelId": "stub-reranker",
            "modelRevision": "0",
            "query": "q",
            "candidates": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["scores"] == []


def test_rerank_echoes_server_identity_even_when_request_claims_other_identity(
    client: TestClient,
) -> None:
    response = client.post(
        "/rerank",
        json={
            "modelId": "some/other-reranker",
            "modelRevision": "v999",
            "query": "q",
            "candidates": [{"nodeId": SYM, "text": "a"}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["modelId"] == "stub-reranker"
    assert body["modelRevision"] == "0"


def test_rerank_rejects_extra_candidate_fields(client: TestClient) -> None:
    response = client.post(
        "/rerank",
        json={
            "modelId": "stub-reranker",
            "modelRevision": "0",
            "query": "q",
            "candidates": [
                {"nodeId": SYM, "text": "a", "unknownField": "oops"},
            ],
        },
    )
    assert response.status_code == 422
