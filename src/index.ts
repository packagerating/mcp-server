#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from './config'
import {
  getPackageInputSchema,
  listPackagesInputSchema,
  makeGetPackageHandler,
  makeListPackagesHandler,
  makeRequestCrawlHandler,
  requestCrawlInputSchema,
} from './tools'

async function main(): Promise<void> {
  const config = loadConfig()

  const server = new McpServer({ name: 'packagerating', version: '0.1.0' })

  // The three `@ts-ignore` suppressions below work around a TypeScript-version-specific
  // false positive ("Type instantiation is excessively deep and possibly infinite") in
  // @modelcontextprotocol/sdk@1.29.0's `registerTool` generics (its `OutputArgs` type parameter
  // is unconstrained-by-inference when no `outputSchema` is passed, and combines with the
  // zod v3/v4 compat union types in a way that blows past tsc's instantiation-depth heuristic).
  // Confirmed as a checker false positive, not a real type error: the identical minimal
  // `registerTool(...)` call type-checks cleanly under typescript@5.6.3 and only fails under the
  // 5.9.3 pinned in this repo's devDependencies (isolated repro, not caused by anything specific
  // to this file's schemas — even a single-field `{ name: z.string() }` schema reproduces it).
  // Runtime behavior is unaffected either way (verified via `npm run build` + manual startup).
  // @ts-ignore - see comment above (ts-ignore, not ts-expect-error: ncc's bundler-based typecheck pass doesn't reproduce the error and would flag ts-expect-error as unused)
  server.registerTool(
    'list_packages',
    {
      title: 'List packages',
      description: 'List npm/PyPI packages that have at least one score, sorted by composite score by default.',
      inputSchema: listPackagesInputSchema,
    },
    makeListPackagesHandler(config),
  )

  // @ts-ignore - see comment above (ts-ignore, not ts-expect-error: ncc's bundler-based typecheck pass doesn't reproduce the error and would flag ts-expect-error as unused)
  server.registerTool(
    'get_package',
    {
      title: 'Get package score',
      description:
        'Get the full health/risk score for a single package by name. If the package has never been scored, this triggers a crawl and waits (bounded) for it to finish before returning.',
      inputSchema: getPackageInputSchema,
    },
    makeGetPackageHandler(config),
  )

  // @ts-ignore - see comment above (ts-ignore, not ts-expect-error: ncc's bundler-based typecheck pass doesn't reproduce the error and would flag ts-expect-error as unused)
  server.registerTool(
    'request_crawl',
    {
      title: 'Request a crawl',
      description:
        'Enqueue one or more packages for crawling without waiting for the result. Useful for pre-warming several packages at once, e.g. before comparing alternatives.',
      inputSchema: requestCrawlInputSchema,
    },
    makeRequestCrawlHandler(config),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
