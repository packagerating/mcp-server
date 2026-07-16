# packagerating MCP Server

## Problem

`packagerating/audit-dependencies` and `packagerating/audit-dependencies-python` give Claude (and
any CI system) automated, PR-triggered access to package scores — but only in that one context:
a GitHub Actions workflow run, once per PR. There is no way for Claude to reach live package data
*conversationally*, inside an agentic session — a developer mid-task deciding whether to add a
dependency, a security reviewer running a one-shot audit of an existing repo, or someone in an
architecture-design session comparing alternatives all have to leave the conversation and go query
the API by hand.

The public REST API (`api.packagerating.com`) already exposes everything needed for this — package
listing, per-package detail with six-dimension scores, and on-demand crawling for packages not yet
seen — documented in the main repo's `docs/api-reference.md`. What's missing is a way for an
agentic client to reach it as a first-class tool, rather than through ad hoc `curl` calls a model
has to construct and interpret itself every time.

## Design

### Why an MCP server, and why first

Of the shapes considered (MCP server, Claude skill, subagent, Claude Code plugin, a GitHub-specific
skill), an MCP server is the only one that works from *any* MCP-compatible client — not just Claude
Code — and it's the one every other shape in the roadmap below would eventually want to call into
anyway. It also happens to be the cheapest to build: the underlying API is already public, stable,
and documented, so this server is a thin, stateless adapter, not new backend work. See "Full Scope
— Saved for Later" below for the rest of the roadmap this unlocks.

### Architecture

A single new public repo, `packagerating/mcp-server`, alongside the existing `audit-dependencies`
and `audit-dependencies-python` repos in the org. TypeScript on Node 20 with
`@modelcontextprotocol/sdk`, matching the existing org's stack.

It is a **stateless local stdio MCP server** — no database, no persistent state. Every tool call is
a direct HTTPS request to `api.packagerating.com`. Distributed as an npm package
(`@packagerating/mcp-server`), run via `npx -y @packagerating/mcp-server` from the user's MCP
client config (Claude Code, Claude Desktop, or any other MCP-compatible client).

Auth is a single `PACKAGERATING_API_KEY` environment variable, required at startup. If it's
missing, the server fails fast at startup with a message pointing to the signup flow
(`https://packagerating.com`) — not a silent no-op, and not a per-call failure that wastes a tool
round-trip.

### Tools

Three tools, one per existing endpoint — a thin mirror, not a curated/opinionated layer. Curated,
composite tools (e.g. "evaluate this dependency and give me a verdict") are explicitly out of scope
here; see the roadmap below, where that reasoning lives in a skill layered on top instead.

1. **`list_packages`** → `GET /packages`. Params passed through as-is: `sort`, `order`, `limit`,
   `language`.
2. **`get_package`** → `GET /packages/:name`. Params passed through as-is: `version`, `language`.

   Handles the API's crawl-on-miss behavior internally: `GET /packages/:name` already
   auto-triggers a crawl on a cache miss and can return `202` (with a `job_id` and
   `Retry-After` header) if the crawl doesn't finish within ~20 seconds. Rather than surfacing that
   intermediate state to the caller, `get_package` polls `GET /packages/crawl/:job_id` internally
   (bounded — up to ~60 seconds total, honoring the API's `Retry-After` hint between polls) and
   only returns once it has a final score or a genuine failure. One tool call, one useful answer —
   Claude never has to manage multi-step crawl polling itself. The cost is a slower response on a
   genuinely first-ever package lookup, which is judged an acceptable tradeoff for a much simpler
   calling contract.

3. **`request_crawl`** → `POST /packages/crawl`. Pre-warms one or more packages at once (e.g.
   before a batch comparison in an architecture-design session) — returns immediately, since
   crawling is async server-side; does not poll to completion the way `get_package` does, since the
   caller isn't necessarily waiting on a specific package's result yet.

### Error handling

API errors are surfaced as clear, structured tool-result text, never swallowed:

- `404` (unknown package name) → returned as-is with the package name echoed back.
- `429` (rate limit) → returned as-is; no silent retry loop that could compound rate-limit pressure.
- A `request_crawl` failure → returned as-is.
- Missing or invalid API key → the specific tool call fails with a message telling the user to
  check `PACKAGERATING_API_KEY`, not a generic crash or stack trace.
- `get_package`'s internal crawl poll timing out (bounded ~60s with no final result) → returned as
  a clear "still crawling, try again shortly" result, not an error — this is an expected outcome
  for a very large or slow-to-crawl package, not a failure.

### Testing

Unit tests mock the HTTP layer (mirroring the existing repos' Vitest conventions) — no live API
calls in CI on every PR. One live smoke-test step against the real production API, gated behind a
repo secret (a real `PACKAGERATING_API_KEY`), run manually or on release rather than on every PR —
keeps CI fast and independent of live crawl timing/rate limits.

## Out of Scope (this build)

- **API key provisioning/signup as a tool.** Requires an existing key via
  `PACKAGERATING_API_KEY`, obtained the same way as for the GitHub Actions (self-serve signup at
  packagerating.com). A `request_api_key` tool wrapping `POST /signup` + `/signup/verify` was
  considered and explicitly deferred — it would expand this build past a pure data-mirror and adds
  email-verification-flow complexity that doesn't belong in the first version.
- **Curated/composite tools** (`evaluate_dependency`, `compare_packages`, etc.) — reasoning belongs
  in a skill layered on top of these raw tools, not baked into the MCP server itself. See below.
- **Remote/hosted transport (SSE/HTTP).** Local stdio is sufficient since auth is already a simple
  per-user API key — no OAuth or multi-tenant hosting need that would justify the added
  infrastructure.

## Full Scope — Saved for Later

The original brainstorm covered more than this MCP server, and none of it should be re-litigated
from scratch when it's picked up — captured here as the roadmap this server unlocks:

1. **Skill(s) layered on top of this MCP server** — teach Claude *when and how* to use
   `list_packages`/`get_package`/`request_crawl` for a specific workflow, rather than leaving that
   judgment call to be reinvented in every conversation:
   - **Package-adoption skill** — before adding a new dependency, check its score, compare
     realistic alternatives via `list_packages`, present the tradeoff.
   - **Dependency-audit skill** — walk an existing repo's manifest(s) (`package.json`,
     `requirements.txt`, `pyproject.toml`, etc. — reusing the discovery logic already built for the
     two GitHub Actions is a strong candidate here, not reinventing it), query each dependency via
     `get_package`, synthesize a report. Naturally serves both the "one-time audit" and "pipeline
     governance/compliance" trigger contexts named during brainstorming.
2. **A subagent specialized for deep, autonomous audits** — the "one-shot full-repo audit" and
   "architecture design session" triggers benefit from an agent that can reason across many
   packages and tool calls autonomously, more than a single conversational skill invocation would.
   Complementary to the MCP server (still calls into it for live data), not a replacement.
3. **A GitHub-integration skill for ad hoc, interactive review** — "hey Claude, look at this
   specific PR's dependency changes" from inside a session, composing this MCP server with the
   `gh` CLI. Explicitly complementary to, not a duplicate of, the two existing GitHub Actions:
   those run automatically on *every* PR with no user in the loop; this would be for a human
   directing Claude at one specific PR or issue interactively.
4. **A Claude Code plugin bundling the above** — packaging this MCP server's config plus the
   skill(s) as a single one-command install, mirroring the `github`/`atlassian`-style plugins
   already in the Claude Code plugin marketplace. This is a distribution/packaging decision, not a
   new capability — it wraps items 1–3 once they exist, it doesn't compete with them.

### Self-aware / self-updating components

Raised explicitly during brainstorming and worth carrying forward as a design principle for
whichever of the above gets built next: **this MCP server itself carries no drift risk** — it's
stateless and reflects whatever the live API returns on every call, so it can never go stale
relative to the data. The drift risk lives in the *skill and subagent* layers above, once they
exist: a skill's bundled methodology (e.g. "package-rating uses six dimensions: liveness,
community, security, dependency, versioning, dep-tree risk, weighted such-and-such") is static text
that can silently fall out of sync if packagerating.com adds, removes, or reweights a scoring
dimension.

When a skill or subagent is built on top of this MCP server, it should include an explicit
self-check step against live data rather than trusting its own bundled description of the scoring
methodology — e.g., call `get_package` for a known reference package and compare the dimension
keys actually returned against the ones the skill's instructions describe, and surface a clear
warning (not a silent failure) if they've diverged, prompting the user to check for an updated
version of the skill. This MCP server should keep its tool output shape simple and predictable
enough (i.e., don't hide the raw dimension keys behind a summarized/opinionated field) that a
skill built on top of it can actually perform that comparison — this is part of why "thin mirror,
not curated" was chosen for this build's tool surface, not just an implementation-simplicity
argument.

## Files Touched

This is a new, empty repository — everything is new. Expected top-level shape (finalized in the
implementation plan, not this spec):

| Area | Purpose |
|---|---|
| `src/` | MCP server entry point, tool implementations, HTTP client for `api.packagerating.com` |
| `tests/` | Unit tests (mocked HTTP), Vitest |
| `README.md` | Install/config instructions (`npx` invocation, `PACKAGERATING_API_KEY` setup) |
| `package.json` | npm package metadata, published as `@packagerating/mcp-server` |
| `.github/workflows/` | CI (typecheck, unit tests) + a separate, secret-gated live smoke-test workflow |
