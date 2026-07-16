import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Config } from '../src/config'
import { PackageRatingApiError } from '../src/types'
// Static import instead of the brief's `await import('../src/tools')`: vi.mock calls are
// hoisted by Vitest above all imports in the module regardless of source order, so a normal
// static import here still resolves against the mocked '../src/api-client'. This avoids
// top-level await, which the project's tsconfig (module: commonjs) rejects under
// `tsc --noEmit` even though vitest's esbuild-based runtime happily executes it — a narrow
// test-code-only fix, not a change to the handlers' behavior or assertions.
import { makeListPackagesHandler, makeGetPackageHandler, makeRequestCrawlHandler } from '../src/tools'

const listPackagesMock = vi.fn()
const getPackageMock = vi.fn()
const requestCrawlMock = vi.fn()

vi.mock('../src/api-client', () => ({
  listPackages: (...args: unknown[]) => listPackagesMock(...args),
  getPackage: (...args: unknown[]) => getPackageMock(...args),
  requestCrawl: (...args: unknown[]) => requestCrawlMock(...args),
}))

const config: Config = { apiKey: 'test-key', baseUrl: 'https://api.packagerating.example' }

beforeEach(() => {
  listPackagesMock.mockReset()
  getPackageMock.mockReset()
  requestCrawlMock.mockReset()
})

describe('list_packages handler', () => {
  it('returns the package list as JSON text content', async () => {
    listPackagesMock.mockResolvedValue([{ name: 'axios', general_score: 84.2 }])
    const handler = makeListPackagesHandler(config)

    const result = await handler({ limit: 5 })

    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0]!.text as string)).toEqual([{ name: 'axios', general_score: 84.2 }])
    expect(listPackagesMock).toHaveBeenCalledWith(config, { limit: 5 })
  })

  it('returns an error result with status code when the API call fails', async () => {
    listPackagesMock.mockRejectedValue(new PackageRatingApiError('Too Many Requests', 429))
    const handler = makeListPackagesHandler(config)

    const result = await handler({})

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Too Many Requests')
    expect(result.content[0]!.text).toContain('429')
  })
})

describe('get_package handler', () => {
  it('returns the scored package as JSON text content', async () => {
    getPackageMock.mockResolvedValue({ state: 'scored', package: { name: 'axios', version: '1.7.0' } })
    const handler = makeGetPackageHandler(config)

    const result = await handler({ name: 'axios' })

    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0]!.text as string)).toEqual({ name: 'axios', version: '1.7.0' })
  })

  it('returns a still_crawling status without treating it as an error', async () => {
    getPackageMock.mockResolvedValue({ state: 'still_crawling', jobId: 'job-1' })
    const handler = makeGetPackageHandler(config)

    const result = await handler({ name: 'brandnew' })

    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(result.content[0]!.text as string)
    expect(parsed.status).toBe('still_crawling')
    expect(parsed.job_id).toBe('job-1')
  })

  it('returns an error result for an unknown package (404)', async () => {
    getPackageMock.mockRejectedValue(new PackageRatingApiError("Package 'nope' not found", 404))
    const handler = makeGetPackageHandler(config)

    const result = await handler({ name: 'nope' })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("Package 'nope' not found")
  })
})

describe('request_crawl handler', () => {
  it('returns the enqueue response as JSON text content', async () => {
    requestCrawlMock.mockResolvedValue({ job_id: 'job-3', queued: 2 })
    const handler = makeRequestCrawlHandler(config)

    const result = await handler({ language: 'javascript', packages: ['axios', 'zod'] })

    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0]!.text as string)).toEqual({ job_id: 'job-3', queued: 2 })
    expect(requestCrawlMock).toHaveBeenCalledWith(config, { language: 'javascript', packages: ['axios', 'zod'] })
  })

  it('returns an error result on a 400 validation failure', async () => {
    requestCrawlMock.mockRejectedValue(new PackageRatingApiError('packages must be a non-empty array of strings', 400))
    const handler = makeRequestCrawlHandler(config)

    const result = await handler({ language: 'javascript', packages: [] })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('packages must be a non-empty array of strings')
  })
})
