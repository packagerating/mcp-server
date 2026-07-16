import { describe, it, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  getPackageInputSchema,
  listPackagesInputSchema,
  makeGetPackageHandler,
  makeListPackagesHandler,
  makeRequestCrawlHandler,
  requestCrawlInputSchema,
} from '../src/tools'
import type { Config } from '../src/config'

// This test locks in that src/index.ts's exact `registerTool` call pattern (config, schema,
// description shape) continues to both type-check AND runtime-register successfully against a
// real McpServer/Client pair. It is the code path that previously hit a TypeScript-version-
// specific `registerTool` false positive (fixed by pinning typescript to ^5.4.5) — nothing else
// in the suite exercises SDK registration end-to-end, so this guards against a future SDK or
// TypeScript bump (or an edit to src/index.ts) silently breaking the wiring.
//
// `McpServer` has no public introspection method (no `listTools()` on `McpServer` or on its
// underlying `server: Server`), so the only SDK-supported way to verify registration is to
// actually connect a real client over a real transport and issue a `tools/list` request, exactly
// as an MCP client would. `InMemoryTransport.createLinkedPair()` (exported from the SDK's
// `inMemory.js`) exists for exactly this: it produces two linked in-process transports, one for
// a `Server`/`McpServer` and one for a `Client`.
describe('MCP server tool registration', () => {
  it('registers exactly the three expected tools with the SDK', async () => {
    const config: Config = { apiKey: 'test-key', baseUrl: 'https://api.packagerating.example' }
    const server = new McpServer({ name: 'packagerating', version: '0.1.0' })

    server.registerTool(
      'list_packages',
      { title: 'List packages', description: 'List packages', inputSchema: listPackagesInputSchema },
      makeListPackagesHandler(config),
    )
    server.registerTool(
      'get_package',
      { title: 'Get package score', description: 'Get package score', inputSchema: getPackageInputSchema },
      makeGetPackageHandler(config),
    )
    server.registerTool(
      'request_crawl',
      { title: 'Request a crawl', description: 'Request a crawl', inputSchema: requestCrawlInputSchema },
      makeRequestCrawlHandler(config),
    )

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0.1.0' })

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const listed = await client.listTools()
    const names = listed.tools.map(t => t.name).sort()
    expect(names).toEqual(['get_package', 'list_packages', 'request_crawl'])

    await client.close()
    await server.close()
  })
})
