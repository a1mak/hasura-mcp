#!/bin/bash
# Disposable Hasura v2 fixture for @a1mak/hasura-mcp.
#
# The Postgres side lives in schema.sql and the Hasura side in metadata.yaml, so
# both are readable and editable as themselves — and the metadata can explain, in
# comments, which behaviour each object exists to pin.
#
#   bash setup.sh                  build containers, then apply
#   bash setup.sh --objects-only   apply to an engine that is already running
set -euo pipefail

cd "$(dirname "$0")"

E=${HASURA_FIXTURE_ENDPOINT:-http://localhost:8299}
SECRET=${HASURA_FIXTURE_SECRET:-fixture}
ENGINE_VERSION=${HASURA_FIXTURE_VERSION:-v2.48.5}
# Where the engine reaches ITSELF, for the self-referential remote schema. With a
# port mapping that is the in-container port; under host networking it is the
# published one. Getting this wrong leaves remote_schemas silently empty.
SELF=${HASURA_FIXTURE_SELF_URL:-http://localhost:8080/v1/graphql}

# curl exits 0 on an API error, so without this a failed call leaves a half-built
# fixture while the script still reports success.
api() {
  local path=$1 payload=$2 out
  out=$(curl -s -H 'content-type: application/json' -H "x-hasura-admin-secret: $SECRET" \
    --data-binary "$payload" "$E$path")
  case "$out" in
    *'"error"'*)
      echo "$out" >&2
      echo "FIXTURE SETUP FAILED on $path" >&2
      exit 1
      ;;
  esac
  echo "$out"
}

if [ "${1:-}" != "--objects-only" ]; then
  echo "== containers =="
  docker network create hmcp-fixture-net >/dev/null 2>&1 || true
  docker rm -f hmcp-fixture-db hmcp-fixture-engine >/dev/null 2>&1 || true

  docker run -d --name hmcp-fixture-db --network hmcp-fixture-net \
    -e POSTGRES_PASSWORD=fixture -e POSTGRES_USER=fixture -e POSTGRES_DB=fixture \
    postgres:16 >/dev/null

  # The engine exits if Postgres is not accepting connections on its first boot.
  until docker exec hmcp-fixture-db pg_isready -U fixture >/dev/null 2>&1; do sleep 1; done

  docker run -d --name hmcp-fixture-engine --network hmcp-fixture-net -p 8299:8080 \
    -e HASURA_GRAPHQL_DATABASE_URL=postgres://fixture:fixture@hmcp-fixture-db:5432/fixture \
    -e HASURA_GRAPHQL_ADMIN_SECRET="$SECRET" \
    -e HASURA_GRAPHQL_DEV_MODE=true \
    "hasura/graphql-engine:$ENGINE_VERSION" >/dev/null

  until curl -s -m 2 "$E/v1/version" >/dev/null 2>&1; do sleep 1; done
fi

curl -s "$E/v1/version"; echo

echo "== schema.sql =="
api /v2/query "$(node -e '
const fs = require("fs");
const sql = fs.readFileSync("schema.sql", "utf8");
console.log(JSON.stringify({ type: "run_sql", args: { source: "default", sql } }));
')" >/dev/null && echo "applied"

echo "== metadata.yaml =="
api /v1/metadata "$(node -e '
const yaml = require("yaml"), fs = require("fs");
const meta = yaml.parse(fs.readFileSync("metadata.yaml", "utf8"));
meta.remote_schemas[0].definition.url = process.argv[1];
console.log(JSON.stringify({ type: "replace_metadata", args: meta }));
' "$SELF")" >/dev/null && echo "applied"

echo "== consistency =="
api /v1/metadata '{"type":"get_inconsistent_metadata","args":{}}'

cat <<MSG

Ready at $E (admin secret: $SECRET).
Fire a failing delivery:  python3 probe_logs.py
Tear down:                docker rm -f hmcp-fixture-engine hmcp-fixture-db
MSG
