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

  server.registerTool(
    'list_packages',
    {
      title: 'List packages',
      description: 'List npm/PyPI packages that have at least one score, sorted by composite score by default.',
      inputSchema: listPackagesInputSchema,
    },
    makeListPackagesHandler(config),
  )

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
