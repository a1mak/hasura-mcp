---
'@a1mak/hasura-mcp': patch
---

`list_tables` now reads the tracked table list from metadata rather than the Postgres-only
`pg_get_source_tables` call, so it answers on any backend whose metadata identifies tables by
schema and name — MS SQL Server included — instead of failing outright.

This also corrects what the tool returns. `pg_get_source_tables` listed every table *available*
in the database, so untracked tables appeared even though they are not queryable through
GraphQL, contradicting the tool's own description. Only tracked tables are listed now.

An unknown `source` is answered directly, naming the sources that do exist, instead of relaying
the engine's bare `source with name "x" does not exist`.
