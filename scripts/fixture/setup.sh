#!/bin/bash
# Disposable Hasura v2 fixture for @a1mak/hasura-mcp.
# Brings up the stack and adds one of every metadata object type, so the
# "verified" claims in ../specs/2026-09-01-hasura-mcp-tool-spec.md can be re-checked.
#
#   bash setup.sh          # full build from nothing
#   bash setup.sh --objects-only   # skip docker, just re-add the metadata objects
set -euo pipefail

E=http://localhost:8299
SECRET=fixture

md() { curl -s -H 'content-type: application/json' -H "x-hasura-admin-secret: $SECRET" -d "$1" $E/v1/metadata; echo; }
q2() { curl -s -H 'content-type: application/json' -H "x-hasura-admin-secret: $SECRET" -d "$1" $E/v2/query; echo; }

if [ "${1:-}" != "--objects-only" ]; then
  echo "== stack =="
  docker network create hmcp-fixture-net >/dev/null 2>&1 || true
  docker rm -f hmcp-fixture-db hmcp-fixture-engine >/dev/null 2>&1 || true

  docker run -d --name hmcp-fixture-db --network hmcp-fixture-net \
    -e POSTGRES_PASSWORD=fixture -e POSTGRES_USER=fixture -e POSTGRES_DB=fixture \
    postgres:16 >/dev/null

  # The engine exits if Postgres is not accepting connections on its first boot.
  until docker exec hmcp-fixture-db pg_isready -U fixture >/dev/null 2>&1; do sleep 1; done

  docker run -d --name hmcp-fixture-engine --network hmcp-fixture-net -p 8299:8080 \
    -e HASURA_GRAPHQL_DATABASE_URL=postgres://fixture:fixture@hmcp-fixture-db:5432/fixture \
    -e HASURA_GRAPHQL_ADMIN_SECRET=$SECRET \
    -e HASURA_GRAPHQL_DEV_MODE=true \
    hasura/graphql-engine:v2.48.5 >/dev/null

  until curl -s -m 2 $E/v1/version >/dev/null 2>&1; do sleep 1; done
  curl -s $E/v1/version; echo
fi

echo "== table + permission =="
q2 '{"type":"run_sql","args":{"source":"default","sql":"create table if not exists patient_consent (id uuid primary key default gen_random_uuid(), patient_id uuid not null, granted_at timestamptz);"}}'
md '{"type":"pg_track_table","args":{"source":"default","table":{"schema":"public","name":"patient_consent"}}}'
md '{"type":"pg_create_select_permission","args":{"source":"default","table":{"schema":"public","name":"patient_consent"},"role":"patient","permission":{"columns":["id","patient_id","granted_at"],"filter":{"patient_id":{"_eq":"X-Hasura-User-Id"}},"limit":100}}}'

echo "== seed rows the dry-run test counts against =="
curl -s -H 'content-type: application/json' -H "x-hasura-admin-secret: $SECRET" \
  -d '{"query":"mutation { insert_patient_consent(objects:[{patient_id:\"11111111-1111-1111-1111-111111111111\"},{patient_id:\"11111111-1111-1111-1111-111111111111\"},{patient_id:\"22222222-2222-2222-2222-222222222222\"}]) { affected_rows } }"}' \
  $E/v1/graphql; echo

echo "== computed field =="
# NOTE: the parameter cannot be named `row` — reserved, fails with a syntax error.
q2 '{"type":"run_sql","args":{"source":"default","sql":"create or replace function consent_is_active(pc patient_consent) returns boolean as $$ select pc.granted_at is not null $$ language sql stable;"}}'
md '{"type":"pg_add_computed_field","args":{"source":"default","table":{"schema":"public","name":"patient_consent"},"name":"is_active","definition":{"function":{"schema":"public","name":"consent_is_active"}}}}'

echo "== event trigger (webhook is unreachable on purpose, to produce failed deliveries) =="
md '{"type":"pg_create_event_trigger","args":{"source":"default","name":"on_consent_created","table":{"schema":"public","name":"patient_consent"},"webhook":"http://example.invalid/hook","insert":{"columns":"*"},"retry_conf":{"num_retries":1,"interval_sec":5,"timeout_sec":5}}}'

echo "== custom types + action + action permission =="
md '{"type":"set_custom_types","args":{"input_objects":[{"name":"RevokeConsentInput","fields":[{"name":"consentId","type":"uuid!"},{"name":"reason","type":"String"}]}],"objects":[{"name":"RevokeConsentOutput","fields":[{"name":"ok","type":"Boolean!"},{"name":"revokedAt","type":"timestamptz"}]}]}}'
md '{"type":"create_action","args":{"name":"revokeConsent","definition":{"kind":"synchronous","type":"mutation","arguments":[{"name":"input","type":"RevokeConsentInput!"}],"output_type":"RevokeConsentOutput!","handler":"http://example.invalid/revoke","forward_client_headers":true},"comment":"Revoke a consent and notify downstream"}}'
md '{"type":"create_action_permission","args":{"action":"revokeConsent","role":"patient"}}'

echo "== cron trigger =="
md '{"type":"create_cron_trigger","args":{"name":"nightly_consent_audit","webhook":"http://example.invalid/audit","schedule":"0 2 * * *","include_in_metadata":true,"retry_conf":{"num_retries":0}}}'

echo "== remote schema, pointed at this instance =="
# Needs BOTH a root-field namespace AND a type-name prefix. With only the namespace,
# type names still collide: "conflicting definitions for GraphQL type
# 'patient_consent_select_column'".
md '{"type":"add_remote_schema","args":{"name":"self_remote","definition":{"url":"http://localhost:8080/v1/graphql","headers":[{"name":"x-hasura-admin-secret","value":"fixture"}],"forward_client_headers":false,"timeout_seconds":30,"customization":{"root_fields_namespace":"remote","type_names":{"prefix":"rmt_"}}}}}'

echo "== consistency =="
md '{"type":"get_inconsistent_metadata","args":{}}'

echo
echo "Ready at $E (admin secret: $SECRET)."
echo "Fire a failing delivery:  python3 probe_logs.py"
echo "Tear down:                docker rm -f hmcp-fixture-engine hmcp-fixture-db"
