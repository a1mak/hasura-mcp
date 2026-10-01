# Disposable Hasura fixture

The integration suite runs against this, in CI and locally. Every claim in the
"Verified against the fixture" table of the tool spec was measured here.

| file | what it holds |
|---|---|
| `schema.sql` | the Postgres side — table, the computed-field function, seed rows |
| `metadata.yaml` | the Hasura side — one of every metadata object type, applied with `replace_metadata` |
| `setup.sh` | orchestration only: containers, then the two files above |
| `probe_logs.py` | fires the event trigger against an unreachable webhook and dumps the delivery-log columns |

```sh
bash setup.sh                  # build containers, then apply
bash setup.sh --objects-only   # apply to an engine that is already running (CI does this)
docker rm -f hmcp-fixture-engine hmcp-fixture-db   # tear down
```

Endpoint `http://localhost:8299`, admin secret `fixture`. Both re-runnable: the SQL
guards on `if not exists` and `replace_metadata` is a whole-document swap.

Overridable: `HASURA_FIXTURE_ENDPOINT`, `HASURA_FIXTURE_SECRET`,
`HASURA_FIXTURE_VERSION`, `HASURA_FIXTURE_SELF_URL`.

## What it deliberately contains

One of every metadata object type, because several verified facts are about objects
that are not tables: a computed field (queryable, yet invisible to
`information_schema`), an event trigger with an unreachable webhook (so there are
failed deliveries to inspect), an action with custom input and output types and a role
permission, a cron trigger, and a remote schema.

## Traps encoded here

- **Start Postgres before the engine.** The engine exits outright if the database is
  not accepting connections on its first boot.
- **`HASURA_FIXTURE_SELF_URL`.** The remote schema points the engine at itself, and
  that address differs between a port-mapped container (`8080`, the in-container port)
  and host networking (`8299`, the published one). CI uses the latter. Wrong value
  leaves `remote_schemas` empty.
- **A computed field's function parameter cannot be named `row`** — reserved, and
  Postgres rejects the definition.
- **Self-stitching a remote schema needs both** `root_fields_namespace` *and*
  `type_names.prefix`, or root fields and type names collide.
- **`curl` exits 0 on an API error**, which is why `setup.sh` inspects each response
  and exits 1. Without that a half-built fixture reports success and the breakage
  surfaces later as unrelated test failures.
- **`zsh` does not word-split unquoted variables**, so `curl $HEADERS` silently drops
  them and every request comes back `access-denied`.
