# CLAUDE.md — @a1mak/hasura-mcp

## Communication

When reporting information to me, be extremely concise and sacrifice grammar for the sake of concision.

## Do this first, every session

1. **Read this file to the end.** Constraints and design decisions are settled; re-deriving them wastes a turn.
2. **Check the shipped SDK typings before writing protocol code** — `node_modules/@modelcontextprotocol/server/dist/*.d.mts`. Docs and skills have already been wrong about this package twice (see Conventions).
3. **This package owns no database.** Anything needing a live Hasura runs against a disposable container spun up as a fixture — never a stack you don't own.
4. **Run `npm run typecheck`** after edits, and exercise any changed tool in the MCP Inspector before claiming it works.

## What this is

An MCP server for **Hasura GraphQL Engine v2** (self-hosted, open-source). Generic and vendor-neutral: nothing in this package may be specific to any particular company's schema, naming, or deployment.

Published as `@a1mak/hasura-mcp` on npm, run via `npx -y @a1mak/hasura-mcp`.

> **The tool surface, and the research and measurements behind the constraints below, belong in the spec — not here.** This file holds only what constrains how you work.
>
> Specs, plans and research live in `docs/superpowers/` (specs in `specs/`, plans in `plans/`). That tree is **gitignored** — local working memory, not shipped. Current research: `docs/superpowers/specs/2026-08-27-hasura-mcp-research.md`.

## Non-negotiable constraints

- **The server never dumps.** It holds metadata internally and answers narrow questions. Full introspection is ~1 MB and `export_metadata` ~136 KB on a mid-size instance — no agent can read either. Every tool returns the narrowest useful answer.
- **No full-introspection tool.** Not as an escape hatch, not behind a flag. Shipping the footgun guarantees someone fires it.
- **Discovery reads metadata, never infers.** Two inferences are forbidden because both fail silently:
  - *No shape heuristics.* "An object type with an `id` field is a table" drops enum tables keyed on `value`, which Hasura codebases use routinely.
  - *No assumed naming convention.* Whether columns surface as `snake_case` or `camelCase` in GraphQL is per-instance configuration. Both are valid; neither can be assumed.

  A wrong-but-confident schema answer is the failure mode this package exists to prevent.
- **No unguarded `run_sql`.** If raw SQL is ever exposed it must be read-only-enforced and separate from any write path.
- **No `apply_migration` / `metadata apply` wrappers.** The `hasura` CLI already does this and is what users' CI runs. A second path invites drift.
- **Keep the tool count near nine, one tool per action.** Every tool schema is permanent context cost for every user on every turn; twelve tools each saving a little is a net loss.

## Design decisions (settled — do not relitigate without asking)

- **Hasura v2 only.** v3/DDN has a different metadata model and would double the surface; it goes behind an adapter later, not in v1.
- **Local project directory is optional enrichment.** Endpoint-only by default so it works against any Hasura URL; when a Hasura CLI project (`config.yaml`) is configured, migration-drift and metadata-diff tools light up.
- **Distribution: npx/stdio now, MCPB later.** Audience is developers who already have Node and want the config pinned per-repo. MCPB is a packaging step over the same code, deferred until the tool surface settles.
- **TypeScript**, `@modelcontextprotocol/server` **v2** (the 2026-07-28 spec line). Not `@modelcontextprotocol/sdk` v1 — that is the previous generation.
- TypeScript pinned to **5.9**, not 7.x, deliberately: this ships `.d.ts` and the native compiler is too new to bet a library on. Revisit later.

## Protocol notes (2026-07-28 spec)

The protocol is **stateless**. There is no session and no `initialize` handshake; every request carries its own protocol version, client info, and capabilities in `_meta.io.modelcontextprotocol/*`.

**Servers MUST NOT initiate JSON-RPC requests.** When the server needs user input it *answers* with an `InputRequiredResult` and the client retries the whole call — the Multi Round-Trip Request (MRTR) pattern.

Mutation confirmation is built on it:

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
- Read and write tools must be **separate**. A single tool taking both safe and unsafe operations is rejected by Anthropic's directory review — not a gate we're currently subject to, but the right shape regardless. Every tool gets a `title` and the applicable annotation (`readOnlyHint` / `destructiveHint`); those drive whether a host auto-runs it or prompts.

## Conventions

### Consult the source of truth first

- **Check official documentation and the shipped SDK before implementing a custom solution.** The MCP spec and the SDK provide primitives for most of what this server needs — use them instead of reinventing.
- **Think "what would the SDK authors recommend?"** When the SDK provides a specific mechanism (MRTR, `createRequestStateCodec`, `serveStdio`), prefer it over a workaround.
- **Verify against the shipped package, not prose.** Docs and skills have already been wrong twice on this project: the guiding skill named a superseded package (`@modelcontextprotocol/sdk` v1), and two official doc pages gave conflicting stdio APIs. Read `node_modules/@modelcontextprotocol/server/dist/*.d.mts`.
- Reference sources: the [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28), the [TS SDK docs](https://ts.sdk.modelcontextprotocol.io/v2/), and Hasura's v2 API reference.

### Verify before asserting

Never claim a tool works, a bug is fixed, or a build passes without having run the command and read the output. `npm run typecheck` for types; the MCP Inspector for tool behaviour; a disposable Hasura fixture for anything touching the wire. Evidence before assertions, always.

### Code style

- **Early returns** to reduce nesting and improve readability.
- **Generics** for type safety and reusability.
- **Functional over OOP** — pure functions, immutability, composition.
- **Strict TypeScript** with proper type annotations. No `any` escapes without a comment justifying it.
- **Pattern matching (`ts-pattern`)**: use `match(...)` when branching on a discriminated union, a `status`/enum, or multi-case domain logic — MCP result types, elicitation outcomes and Hasura error shapes all qualify. Prefer `.exhaustive()` for closed unions so a new case is a compile error, `.otherwise()` for open sets. Don't force it on a simple boolean — a guard or early return is fine there.

### Tooling and quality

- ESLint, Prettier, TypeScript strict mode.
- Husky git hooks with **conventional commits** (also the basis for automated changelogs on npm release).

> **Not yet installed.** The repo currently has strict TypeScript only. Setting up ESLint/Prettier/Husky is an open task, as is adding `ts-pattern` as a dependency.

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

## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.

You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.
