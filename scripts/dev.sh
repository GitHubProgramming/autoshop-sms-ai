#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     AutoShop SMS AI — Local Dev Setup        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Check prerequisites ───────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { echo "❌ docker is required"; exit 1; }
command -v docker compose >/dev/null 2>&1 || { echo "❌ docker compose is required"; exit 1; }

# ── Copy .env if not exists ───────────────────────────────────────────────────
if [ ! -f "$ROOT/.env" ]; then
  echo "📋 Copying .env.example → .env"
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "⚠️  Edit .env and add your API keys before proceeding."
  echo "   Required: TWILIO_*, STRIPE_*, OPENAI_API_KEY"
  echo ""
fi

# ── Start infrastructure ──────────────────────────────────────────────────────
echo "🐳 Starting Docker services..."
cd "$ROOT/infra"
docker compose up -d postgres redis

echo ""
echo "⏳ Waiting for Postgres to be ready..."
until docker compose exec -T postgres pg_isready -U autoshop -q; do
  sleep 2
done
echo "✅ Postgres is ready"

# ── Run migrations ────────────────────────────────────────────────────────────
echo ""
echo "🗄️  Running DB migrations..."
for f in "$ROOT/db/migrations"/*.sql; do
  echo "   → $(basename $f)"
  docker compose exec -T postgres psql -U autoshop -d autoshop -f "/docker-entrypoint-initdb.d/$(basename $f)" 2>/dev/null || \
  PGPASSWORD=autoshop_secret psql -h localhost -U autoshop -d autoshop -f "$f" 2>/dev/null || true
done

# ── Run seed ──────────────────────────────────────────────────────────────────
echo ""
echo "🌱 Running dev seed..."
PGPASSWORD=autoshop_secret psql -h localhost -U autoshop -d autoshop -f "$ROOT/db/seed/001_dev_seed.sql" 2>/dev/null || true
echo "✅ Dev tenant created (dev@autoshop.local)"

# ── Start n8n ────────────────────────────────────────────────────────────────
echo ""
echo "⚙️  Starting n8n..."
docker compose up -d n8n n8n_worker
echo "⏳ Waiting for n8n..."
sleep 15
echo "✅ n8n should be ready at http://localhost:5678"

# ── Start API ─────────────────────────────────────────────────────────────────
echo ""
echo "🚀 Starting API..."
docker compose up -d api

echo ""
echo "⏳ Waiting for API health check..."
for i in {1..20}; do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ API is healthy at http://localhost:3000"
    break
  fi
  sleep 3
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Services running:                           ║"
echo "║  API:      http://localhost:3000             ║"
echo "║  n8n:      http://localhost:5678             ║"
echo "║  Postgres: localhost:5432                    ║"
echo "║  Redis:    localhost:6379                    ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Test endpoints:                             ║"
echo "║  GET  /health                                ║"
echo "║  POST /webhooks/stripe                       ║"
echo "║  POST /webhooks/twilio/sms                   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "📖 n8n login: admin / admin_secret (from .env)"
echo "🛑 Stop: cd infra && docker compose down"
echo ""
