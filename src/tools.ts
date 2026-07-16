import { z } from 'zod'
import type { Config } from './config'
import { getPackage, listPackages, requestCrawl } from './api-client'
import { PackageRatingApiError } from './types'

// Narrower than the SDK's `CallToolResult` (whose `content` items are a union of text/image/
// audio/resource blocks): every handler here only ever emits a single text block. The index
// signature makes this structurally assignable to `CallToolResult` (which itself has one) so it
// can be passed straight to `McpServer#registerTool` in src/index.ts, while keeping `.text`
// directly accessible (without a `.type === 'text'` narrowing check) in tests.
interface ToolTextResult {
  [x: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function errorResult(message: string): ToolTextResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function jsonResult(data: unknown): ToolTextResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function describeError(err: unknown): string {
  if (err instanceof PackageRatingApiError) return `${err.message} (HTTP ${err.status})`
  return err instanceof Error ? err.message : String(err)
}

export const listPackagesInputSchema = {
  sort: z
    .enum(['general_score', 'automation_score', 'risk_score', 'name'])
    .optional()
    .describe('Field to sort by. Defaults to general_score.'),
  order: z.enum(['asc', 'desc']).optional().describe('Sort direction. Defaults to desc.'),
  limit: z.number().int().min(1).max(200).optional().describe('Max results, 1-200. Defaults to 50.'),
  language: z.enum(['javascript', 'python']).optional().describe('Filter by language ecosystem.'),
}

type ListPackagesArgs = {
  sort?: 'general_score' | 'automation_score' | 'risk_score' | 'name'
  order?: 'asc' | 'desc'
  limit?: number
  language?: 'javascript' | 'python'
}

export function makeListPackagesHandler(config: Config) {
  return async (args: ListPackagesArgs): Promise<ToolTextResult> => {
    try {
      const packages = await listPackages(config, args)
      return jsonResult(packages)
    } catch (err) {
      return errorResult(describeError(err))
    }
  }
}

export const getPackageInputSchema = {
  name: z.string().min(1).describe('Package name in its registry, e.g. "axios" or "requests".'),
  version: z.string().optional().describe('Specific version to look up. Defaults to the most recently crawled version.'),
  language: z.enum(['javascript', 'python']).optional().describe('Language ecosystem. Defaults to javascript.'),
}

type GetPackageArgs = { name: string; version?: string; language?: 'javascript' | 'python' }

export function makeGetPackageHandler(config: Config) {
  return async (args: GetPackageArgs): Promise<ToolTextResult> => {
    try {
      const result = await getPackage(config, args.name, { version: args.version, language: args.language })
      if (result.state === 'still_crawling') {
        return jsonResult({
          status: 'still_crawling',
          job_id: result.jobId,
          message: `'${args.name}' has never been scored before and is still being crawled. Try calling get_package again with the same name in a bit.`,
        })
      }
      return jsonResult(result.package)
    } catch (err) {
      return errorResult(describeError(err))
    }
  }
}

export const requestCrawlInputSchema = {
  language: z.enum(['javascript', 'python']).describe('Language ecosystem of the packages to crawl.'),
  packages: z.array(z.string().min(1)).min(1).describe('Package names to enqueue for crawling.'),
}

type RequestCrawlArgs = { language: 'javascript' | 'python'; packages: string[] }

export function makeRequestCrawlHandler(config: Config) {
  return async (args: RequestCrawlArgs): Promise<ToolTextResult> => {
    try {
      const result = await requestCrawl(config, args)
      return jsonResult(result)
    } catch (err) {
      return errorResult(describeError(err))
    }
  }
}
