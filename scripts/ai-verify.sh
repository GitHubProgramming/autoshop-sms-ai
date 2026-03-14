#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
NOTIFY="$SCRIPT_DIR/notify-telegram.sh"
BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Send error notification on failure
trap 'bash "$NOTIFY" "❌ AI Verify FAILED on branch: $BRANCH"' ERR

echo "Running AI verification..."

cd "$REPO_ROOT/apps/api"

echo "Install deps"
npm ci

echo "Lint"
npm run lint

echo "Build"
npm run build

echo "Tests"
npm test

cd "$REPO_ROOT"

echo "Docker smoke test"
docker compose -f "$REPO_ROOT/infra/docker-compose.yml" build
docker compose -f "$REPO_ROOT/infra/docker-compose.yml" down -v --remove-orphans 2>/dev/null || true
docker compose -f "$REPO_ROOT/infra/docker-compose.yml" up -d

sleep 30

curl -sf http://localhost:3000/health || exit 1

echo "AI VERIFY PASSED"
bash "$NOTIFY" "✅ AI Verify PASSED on branch: $BRANCH"
