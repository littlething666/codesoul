#!/usr/bin/env bash
# Nightly determinism check: indexing the same fixture twice with the
# same inputs must produce identical observable output. The CLI's
# `batchId` is per-run by construction, so we strip it before
# comparing; everything else (status, parser, rigExtractors, embedder,
# reranker, vectorStore, graphStore, nodes, edges, vectors) must agree
# byte-for-byte.
#
# This is intentionally a thin first cut. Once the CLI grows a real
# graph-export (currently a stub), the diff should fold in the
# materialized graph + vector content as well.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURES=(
	"fixtures/tiny-ts-lib"
	"fixtures/medium-ts-lib"
)
PARSERS=("regex" "tree-sitter")

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail=0
for fixture in "${FIXTURES[@]}"; do
	for parser in "${PARSERS[@]}"; do
		name="$(basename "$fixture")-$parser"
		a="$WORK/$name-a.json"
		b="$WORK/$name-b.json"
		pnpm --silent exec tsx apps/cli/src/bin.ts index "$fixture" \
			--dry-run --parser "$parser" \
			| jq 'del(.batchId)' > "$a"
		pnpm --silent exec tsx apps/cli/src/bin.ts index "$fixture" \
			--dry-run --parser "$parser" \
			| jq 'del(.batchId)' > "$b"
		if diff -u "$a" "$b"; then
			echo "OK: $name"
		else
			echo "FAIL: $name (see diff above)" >&2
			fail=1
		fi
	done
done

exit "$fail"
