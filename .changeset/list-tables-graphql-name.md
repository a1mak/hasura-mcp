---
'@a1mak/hasura-mcp': minor
---

`list_tables` now reports each table's GraphQL name alongside its database name. The two differ on
any instance using a camelCase naming convention, or wherever a table carries a `custom_name`, and
the GraphQL one is what a query must actually use — so the orientation tool no longer hands back
names that do not work.

The name is read from the live schema rather than calculated from the naming convention. Hasura
applies two different transforms to one table name and uses a `custom_name` untransformed, so a
calculated name would be confidently wrong for a whole class of instances. Where the name cannot be
read, the field is `null` rather than a guess: a null is distinguishable from a verified answer, the
database name is not.

Losing the GraphQL names never loses the answer. If introspection fails, the table list is still
returned with every `graphqlName` null.
