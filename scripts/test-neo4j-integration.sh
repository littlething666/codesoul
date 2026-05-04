#!/usr/bin/env bash
# Convenience runner for the Neo4j graph store integration suite.
#
# Boots the `neo4j` service from docker-compose.yml, waits for it to be
# healthy (Compose v2 `--wait`), runs the integration tests against it,
# and tears the container down on exit. Set `KEEP_NEO4J=1` to leave the
# container running after the run for follow-up debugging.
#
# Requirements: Docker (with Compose v2), pnpm.
#
# Usage:
#   ./scripts/test-neo4j-integration.sh
#   KEEP_NEO4J=1 ./scripts/test-neo4j-integration.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

NEO4J_INTEGRATION_URL="${NEO4J_INTEGRATION_URL:-bolt://localhost:7687}"
NEO4J_INTEGRATION_USER="${NEO4J_INTEGRATION_USER:-neo4j}"
NEO4J_INTEGRATION_PASSWORD="${NEO4J_INTEGRATION_PASSWORD:-password}"
NEO4J_INTEGRATION_DATABASE="${NEO4J_INTEGRATION_DATABASE:-neo4j}"

cleanup() {
	if [[ "${KEEP_NEO4J:-0}" == "1" ]]; then
		echo "[neo4j-integration] KEEP_NEO4J=1 — leaving container running."
		return
	
fi
	echo "[neo4j-integration] Tearing down Neo4j container..."
	docker compose down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[neo4j-integration] Starting Neo4j (5.26-community)..."
docker compose up -d --wait neo4j

echo "[neo4j-integration] Running integration suite..."
NEO4J_INTEGRATION_URL="$NEO4J_INTEGRATION_URL" \
NEO4J_INTEGRATION_USER="$NEO4J_INTEGRATION_USER" \
NEO4J_INTEGRATION_PASSWORD="$NEO4J_INTEGRATION_PASSWORD" \
NEO4J_INTEGRATION_DATABASE="$NEO4J_INTEGRATION_DATABASE" \
pnpm --filter @codesoul/graph-store-neo4j test
