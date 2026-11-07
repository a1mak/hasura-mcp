---
'@a1mak/hasura-mcp': patch
---

`list_tables` now reads the tracked table list from metadata rather than the Postgres-only
`pg_get_source_tables` call, so it answers on MS SQL Server, BigQuery and data-connector
sources instead of failing. It also names the available sources when an unknown one is
requested, rather than returning an empty list that reads as "this database has no tables".
