# packagerating MCP Server

Give Claude (or any [MCP](https://modelcontextprotocol.io)-compatible client) live, on-demand
access to [packagerating.com](https://packagerating.com) package health/risk scores — right inside
your coding session, not just in CI.

Three tools, each a thin mirror of the public REST API:

| Tool | What it does |
|---|---|
| `list_packages` | List scored packages, sorted by composite score by default |
| `get_package` | Full score + dimension breakdown for one package by name. Transparently waits for a first-ever crawl to finish. |
| `request_crawl` | Pre-warm one or more packages for crawling without waiting on the result |

## Setup

1. Get a free API key at [packagerating.com](https://packagerating.com).
2. Add this server to your MCP client config. For Claude Code, add to your MCP settings:

```json
{
  "mcpServers": {
    "packagerating": {
      "command": "npx",
      "args": ["-y", "@packagerating/mcp-server"],
      "env": {
        "PACKAGERATING_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

That's it — no local install, no build step. `npx` fetches the latest published version each time.

## Example

> "Is `left-pad` safe to add as a dependency? What about `lodash`?"

Claude calls `get_package` for each name and can compare the results directly in conversation —
liveness, community, security, dependency posture, versioning, and dependency-tree risk, plus the
three composite scores (General, Automation, Risk).

## Development

```bash
npm install
npm test          # unit tests, mocked HTTP — no live API calls
npm run typecheck
npm run build      # bundles to dist/index.js via @vercel/ncc
npm run smoke-test # exercises the real production API — requires a real PACKAGERATING_API_KEY
```

## Related

- [`packagerating/audit-dependencies`](https://github.com/packagerating/audit-dependencies) — GitHub Action, npm dependencies
- [`packagerating/audit-dependencies-python`](https://github.com/packagerating/audit-dependencies-python) — GitHub Action, Python dependencies
- [API reference](https://packagerating.com) — the full REST API this server wraps
