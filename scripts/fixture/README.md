# Disposable Hasura fixture

Every claim in the "Verified against the fixture" table of
`../../docs/superpowers/specs/2026-09-01-hasura-mcp-tool-spec.md` was measured here. Gitignored, like the
rest of `docs/superpowers/`.

| file | what it does |
|---|---|
| `setup.sh` | Builds the whole stack and adds one of every metadata object type: table, permission, computed field, event trigger, action (+ custom types + action permission), cron trigger, remote schema. `--objects-only` skips docker. |
| `probe_logs.py` | Fires the event trigger against an unreachable webhook, waits, then dumps the exact column lists of `event_log`, `event_invocation_logs`, `hdb_cron_events`, `hdb_scheduled_events` and `hdb_action_log`, plus a real failed delivery. |

Endpoint `http://localhost:8299`, admin secret `fixture`.
Tear down: `docker rm -f hmcp-fixture-engine hmcp-fixture-db`

## Traps these scripts already encode

- **Start Postgres before the engine.** The engine exits outright if the database is not
  accepting connections on first boot; `docker start` on the engine afterwards recovers it.
- **A computed field's function parameter cannot be named `row`** — reserved, fails with
  `syntax error at or near "row"`.
- **Self-stitching a remote schema needs both** `customization.root_fields_namespace`
  *and* `customization.type_names.prefix`. The namespace alone still collides on type
  names (`conflicting definitions for GraphQL type 'patient_consent_select_column'`).
- **`zsh` does not word-split unquoted variables**, so `curl $HEADERS` silently drops
  them and every request comes back `access-denied`. Pass `-H` flags literally.
