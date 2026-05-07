#!/usr/bin/env bash
# Nightly determinism check: indexing the same fixture twice with the
# same inputs must produce identical observable output. The CLI's
# `batchId` is per-run by construction, so we strip it before
# comparing; everything else (status, parser, rigExtractors, embedder,
# reranker, vectorStore, graphStore, manifestStore, nodes, edges, vectors)
# must agree byte-for-byte.
#
# The graph-export command now produces real JSON output; nightly CI
# should diff `codesoul graph export` output in addition to index metadata.
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
