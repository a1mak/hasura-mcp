# CLAUDE.md — @a1mak/hasura-mcp

## What this is

An MCP server for **Hasura GraphQL Engine v2** (self-hosted, open-source). Generic and vendor-neutral: nothing in this package may be specific to any particular company's schema, naming, or deployment.

Published as `@a1mak/hasura-mcp` on npm, run via `npx -y @a1mak/hasura-mcp`.

## Why it exists

Existing Hasura MCP servers were surveyed before starting. None cover the cases below, and Hasura's own MCP effort targets DDN/PromptQL (cloud v3), leaving the large self-hosted v2 install base unserved.

The core problem is **context cost**. Measured against a real v2.48.5 instance:

| Artifact | Size |
|---|---|
| Full GraphQL introspection | ~1.09 MB |
| `export_metadata` | ~136 KB |
| Generated TS types for one instance | 1.4–2.2 MB |

An agent can never read these. So the design rule is absolute:

> **The server holds metadata internally and answers narrow questions. It never dumps.**

There is deliberately **no `introspect_schema` tool that returns the full schema** — shipping that footgun guarantees someone burns their context on it.

## Design decisions (settled — do not relitigate without asking)

- **Hasura v2 only.** v3/DDN has a different metadata model and would double the surface; it goes behind an adapter later, not in v1.
- **Local project directory is optional enrichment.** Endpoint-only by default so it works against any Hasura URL; when a Hasura CLI project (`config.yaml`) is configured, migration-drift and metadata-diff tools light up.
- **Distribution: npx/stdio now, MCPB later.** Audience is developers who already have Node and want the config pinned per-repo. MCPB is a packaging step over the same code, deferred until the tool surface settles.
- **TypeScript**, `@modelcontextprotocol/server` **v2** (the 2026-07-28 spec line). Not `@modelcontextprotocol/sdk` v1 — that is the previous generation.
- TypeScript pinned to **5.9**, not 7.x, deliberately: this ships `.d.ts` and the native compiler is too new to bet a library on. Revisit later.

## Target tool surface

Roughly nine tools, one per action (the surface is small enough that search+execute would be the wrong pattern). Ranked by value:

1. `describe_table` — one table: columns with both Postgres and GraphQL names, PK, FKs, relationships, **and per-role permissions**. Must resolve names fuzzily and suggest alternatives on a miss.
2. `search_schema` — ranked table/column hits for a term.
3. `run_query` — GraphQL as a plain string; parsed result; **row cap with an explicit `truncated: true` marker**.
4. `list_instances` — configured instances with health and (when a project dir is set) migration state.
5. `list_operations` — actions, event triggers, remote schemas, computed fields.
6. `explain_query` — wraps `/v1/graphql/explain`, which returns both the plan and the generated SQL.
7. `validate_query` — dry-run against the schema, errors only.
8. `migration_status` / `diff_metadata` — local project vs. what the engine has loaded.
9. Mutations — see below.

**Keep the count near this.** Every tool schema is permanent context cost for every user on every turn; twelve tools each saving a little is a net loss.

### Anti-features

- No full-introspection dump tool.
- No unguarded `run_sql`. If raw SQL is ever exposed it must be read-only-enforced and separate from any write path.
- No `apply_migration` / `metadata apply` wrappers — the `hasura` CLI already does this and is what users' CI runs. A second path invites drift.

### Known trap when implementing discovery

Do not identify tables by "has an `id` field" introspection heuristics. Hasura codebases commonly use enum tables keyed on `value` with no `id`, and such tables get silently omitted. Read metadata, not shape guesses. Silent omission is worse than no answer.

## Protocol notes (2026-07-28 spec)

The protocol is **stateless**. There is no session and no `initialize` handshake; every request carries its own protocol version, client info, and capabilities in `_meta.io.modelcontextprotocol/*`.

**Servers MUST NOT initiate JSON-RPC requests.** When the server needs user input it *answers* with an `InputRequiredResult` and the client retries the whole call — the Multi Round-Trip Request (MRTR) pattern.

This is how mutation confirmation works here:

1. Run the mutation as a dry-run, get an affected-row count.
2. Return `inputRequired({ inputRequests: { confirm: inputRequired.elicit({...}) } })` with the count in the message.
3. Client collects confirmation and retries with `inputResponses` + the echoed `requestState`.
4. Verify, then execute.

Use the SDK's own primitives — do not hand-roll:

- `createRequestStateCodec({ key, ttlSeconds, bind })` — HMAC-signed, TTL'd `requestState`. The spec **requires** integrity protection because `requestState` is attacker-controlled and gates whether a mutation runs. Use `bind` to tie state to the method and principal.
- `inputRequired.elicit(...)` to build the request, `acceptedContent(ctx.mcpReq.inputResponses, key)` to read the reply.

Three obligations that follow:

- **Never** send an elicitation request to a client that hasn't declared elicitation support (capabilities are per-request in `_meta`). Have a documented fallback.
- **Never** assume the client retries. A dropped confirmation must leave nothing behind.
- Read/write tools must be **separate**. A single tool taking both safe and unsafe operations is a known rejection reason, and annotations (`readOnlyHint` / `destructiveHint`) drive whether a host auto-runs a tool or prompts. Every tool gets a `title` and the applicable hint.

## Conventions

- Verify against the shipped package, not prose. Docs and skills have already been wrong about package names and the stdio API this project. Read `node_modules/@modelcontextprotocol/server/dist/*.d.mts`.
- `serveStdio(factory)` is the entry point — it serves both the modern stateless era and legacy 2025-era clients from one set of tool registrations. `StdioServerTransport` is the lower-level alternative.
- Never commit a Hasura endpoint, admin secret, or JWT. Config comes from env/CLI at runtime; `.env` is gitignored.

## Commands

```
npm run dev        # tsx src/index.ts
npm run build      # tsc -> dist/
npm run typecheck  # tsc --noEmit
```

## Git identity

This repo commits under the **personal** identity, set repo-locally:

```
user.name  = a1mak
user.email = 8425956+a1mak@users.noreply.github.com
```

The machine's *global* git identity is a work address. Never rely on it here, and check `git log` identity before pushing anything public.
