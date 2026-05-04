# codesoul-model-server

FastAPI model server that the TypeScript HTTP adapters
([`@codesoul/embedder-http`](../../packages/embedder-http) and
[`@codesoul/reranker-http`](../../packages/reranker-http)) speak to.

The wire contract — not the Python or TypeScript code — is the source
of truth. Both sides round-trip the same JSON; either can be replaced
independently as long as the contract holds.

## Endpoints

```
POST /embed    { modelId, modelRevision, dimension, inputs[] }
               -> { modelId, modelRevision, dimension, embeddings[] }
POST /rerank   { modelId, modelRevision, query, candidates[] }
               -> { modelId, modelRevision, scores[] }
GET  /health   -> { ok, embedder, reranker }
```

The server always echoes **its own** identity in responses. Identity
validation is the client's job; the TypeScript adapters throw
`EmbeddingCompatibilityError` (embedder) or `AdapterUnavailableError`
(reranker) on mismatch.

## Backends

| Backend | Embedder | Reranker | Use case |
| --- | --- | --- | --- |
| `stub` | SHA-256-based pseudo-vectors, deterministic | Jaccard similarity over whitespace tokens | CI, local dev without a GPU, contract tests |
| `sentence-transformers` | Qwen/Qwen3-Embedding-0.6B (1024-dim) | Qwen/Qwen3-Reranker-0.6B via the CrossEncoder API | Real workloads |

Real backends are gated behind the `models` extra so `torch` is opt-in:

```bash
pip install -e .[models]
```

## Quickstart (stub backends)

```bash
cd workers/model-server
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
pytest
codesoul-model-server  # uvicorn on 0.0.0.0:8000
```

From the TS side, point the CLI at the running server:

```bash
export CODESOUL_EMBEDDER_URL=http://localhost:8000/embed
export CODESOUL_EMBEDDER_MODEL=stub-embedder
export CODESOUL_EMBEDDER_REVISION=0
export CODESOUL_RERANKER_URL=http://localhost:8000/rerank
export CODESOUL_RERANKER_MODEL=stub-reranker
export CODESOUL_RERANKER_REVISION=0
pnpm --filter @codesoul/cli exec node dist/bin.js query "greet" --repo ./fixtures/tiny-ts-lib
```

## Real Qwen3 backends

The `sentence-transformers` backend loads
[Qwen/Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
(1024-dim) and
[Qwen/Qwen3-Reranker-0.6B](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B)
via `transformers==5.7.0` + `torch==2.11.0`. Per the planning doc's
*Model revision pinning* guardrail, the HF revision must be a concrete
commit SHA, not a branch or tag — the server refuses to start with the
stub default `"0"`:

```bash
pip install -e .[models]

export CODESOUL_MODEL_SERVER_EMBEDDER_BACKEND=sentence-transformers
export CODESOUL_MODEL_SERVER_EMBEDDER_MODEL_ID=Qwen/Qwen3-Embedding-0.6B
export CODESOUL_MODEL_SERVER_EMBEDDER_MODEL_REVISION=<hf-commit-sha>
export CODESOUL_MODEL_SERVER_EMBEDDER_DIMENSION=1024

export CODESOUL_MODEL_SERVER_RERANKER_BACKEND=sentence-transformers
export CODESOUL_MODEL_SERVER_RERANKER_MODEL_ID=Qwen/Qwen3-Reranker-0.6B
export CODESOUL_MODEL_SERVER_RERANKER_MODEL_REVISION=<hf-commit-sha>

# Optional torch device hints (defaults to library auto-detect):
export CODESOUL_MODEL_SERVER_EMBEDDER_DEVICE=cuda:0
export CODESOUL_MODEL_SERVER_RERANKER_DEVICE=cuda:0

codesoul-model-server
```

On the TS side, point `CODESOUL_EMBEDDER_MODEL` / `_REVISION` and
`CODESOUL_RERANKER_MODEL` / `_REVISION` at the same identity strings
the server reports — the adapter raises `EmbeddingCompatibilityError`
on any mismatch instead of silently corrupting the index.

Real-load smoke tests are gated behind `CODESOUL_MODELS_SMOKE=1` plus a
concrete `CODESOUL_QWEN3_EMBEDDING_REVISION` so the multi-GB download
is never accidental:

```bash
CODESOUL_MODELS_SMOKE=1 \
CODESOUL_QWEN3_EMBEDDING_REVISION=<hf-commit-sha> \
pytest tests/test_real_backends.py::test_sentence_transformers_embedder_smoke
```

## Configuration

All settings are read via `pydantic-settings` from `CODESOUL_MODEL_SERVER_*`
env vars (or a `.env` file in the working directory):

| Env var | Default | Notes |
| --- | --- | --- |
| `CODESOUL_MODEL_SERVER_HOST` | `0.0.0.0` | uvicorn bind |
| `CODESOUL_MODEL_SERVER_PORT` | `8000` | uvicorn port |
| `CODESOUL_MODEL_SERVER_EMBEDDER_BACKEND` | `stub` | `stub` \| `sentence-transformers` |
| `CODESOUL_MODEL_SERVER_EMBEDDER_MODEL_ID` | `stub-embedder` | Echoed in responses |
| `CODESOUL_MODEL_SERVER_EMBEDDER_MODEL_REVISION` | `0` | HF commit SHA when backend is `sentence-transformers` (placeholder rejected) |
| `CODESOUL_MODEL_SERVER_EMBEDDER_DIMENSION` | `1024` | Must match `EMBEDDING_DIM` on the TS side and the loaded model's actual dimension |
| `CODESOUL_MODEL_SERVER_EMBEDDER_DEVICE` | _(unset)_ | Optional torch device hint, e.g. `cuda:0`, `mps`, `cpu` |
| `CODESOUL_MODEL_SERVER_RERANKER_BACKEND` | `stub` | `stub` \| `sentence-transformers` |
| `CODESOUL_MODEL_SERVER_RERANKER_MODEL_ID` | `stub-reranker` | Echoed in responses |
| `CODESOUL_MODEL_SERVER_RERANKER_MODEL_REVISION` | `0` | HF commit SHA when backend is `sentence-transformers` (placeholder rejected) |
| `CODESOUL_MODEL_SERVER_RERANKER_DEVICE` | _(unset)_ | Optional torch device hint |
