#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then echo 'Create .env from .env.example first.' >&2; exit 1; fi
set -a
source .env
set +a
export TEST_DATABASE=true
export PG_POOL_MAX=1
export TEST_GROUP_CAPACITY=1
export BASE_URL="http://127.0.0.1:${PORT:-4000}/api/v1"
node scripts/embedded-test-db.mjs &
db_pid=$!
api_pid=''
cleanup(){ [[ -z "$api_pid" ]] || kill "$api_pid" 2>/dev/null || true; kill "$db_pid" 2>/dev/null || true; }
trap cleanup EXIT
for attempt in {1..60}; do
  if ! kill -0 "$db_pid" 2>/dev/null; then echo 'Embedded test database exited before it was ready.' >&2; exit 1; fi
  if node -e "const s=require('node:net').connect(Number(process.env.TEST_DB_PORT||5544),'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),500)"; then break; fi
  if [[ "$attempt" == 60 ]]; then echo 'Embedded test database did not start in time.' >&2; exit 1; fi
  sleep 1
done
npm run db:seed
node --import tsx apps/api/src/server.ts &
api_pid=$!
for attempt in {1..30}; do
  if ! kill -0 "$api_pid" 2>/dev/null; then echo 'API exited before it was ready.' >&2; exit 1; fi
  if curl --silent --fail "$BASE_URL/health" >/dev/null; then break; fi
  if [[ "$attempt" == 30 ]]; then echo 'API did not start in time.' >&2; exit 1; fi
  sleep 1
done
node scripts/admin-smoke.mjs
node scripts/smoke.mjs
