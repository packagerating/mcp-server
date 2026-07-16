import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listPackages, getPackage, requestCrawl } from '../src/api-client'
import { PackageRatingApiError } from '../src/types'
import type { Config } from '../src/config'

const config: Config = { apiKey: 'test-key', baseUrl: 'https://api.packagerating.example' }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listPackages', () => {
  it('sends query params and returns the parsed list on 200', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(
      jsonResponse(200, [{ name: 'axios', general_score: 84.2, automation_score: 88.5, risk_score: 79.1, scored_at: '2026-06-12T00:00:00Z' }]),
    )

    const result = await listPackages(config, { sort: 'name', order: 'asc', limit: 10, language: 'javascript' })

    expect(result).toEqual([{ name: 'axios', general_score: 84.2, automation_score: 88.5, risk_score: 79.1, scored_at: '2026-06-12T00:00:00Z' }])
    const [url, init] = mockFetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.packagerating.example/packages?sort=name&order=asc&limit=10&language=javascript')
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('test-key')
  })

  it('omits unset params from the query string', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(jsonResponse(200, []))

    await listPackages(config, {})

    const [url] = mockFetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.packagerating.example/packages?')
  })

  it('throws PackageRatingApiError with the API error message on a non-200 response', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(jsonResponse(429, { message: 'Too Many Requests' }))

    await expect(listPackages(config, {})).rejects.toMatchObject({
      message: 'Too Many Requests',
      status: 429,
    })
  })
})

describe('getPackage', () => {
  it('returns the scored package on an immediate 200', async () => {
    const mockFetch = vi.mocked(fetch)
    const detail = {
      name: 'axios', version: '1.7.0', language: 'javascript', registry: 'npm',
      registry_url: 'https://npmjs.com/package/axios', github_url: 'https://github.com/axios/axios',
      general_score: 84.2, automation_score: 88.5, risk_score: 79.1, scored_at: '2026-06-12T00:00:00Z',
      dimensions: { liveness: 100, community: 91.4, security: 80, dependency: 70, versioning: 85, dep_risk: 100 },
      signals: {},
    }
    mockFetch.mockResolvedValue(jsonResponse(200, detail))

    const result = await getPackage(config, 'axios')

    expect(result).toEqual({ state: 'scored', package: detail })
    const [url] = mockFetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.packagerating.example/packages/axios?')
  })

  it('URL-encodes the package name and passes version/language params', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(jsonResponse(200, {}))

    await getPackage(config, '@scope/pkg', { version: '1.0.0', language: 'python' })

    const [url] = mockFetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.packagerating.example/packages/%40scope%2Fpkg?version=1.0.0&language=python')
  })

  it('throws a 404 PackageRatingApiError for an unknown package', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(jsonResponse(404, { error: "Package 'nope' not found" }))

    await expect(getPackage(config, 'nope')).rejects.toMatchObject({
      message: "Package 'nope' not found",
      status: 404,
    })
  })

  it('re-polls GET /packages/:name (not the job endpoint) on 202 until it gets a 200, honoring retry_after_seconds', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch
      .mockResolvedValueOnce(jsonResponse(202, { status: 'crawling', job_id: 'job-1', retry_after_seconds: 0 }))
      .mockResolvedValueOnce(jsonResponse(202, { status: 'crawling', job_id: 'job-1', retry_after_seconds: 0 }))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'newpkg' }))

    const result = await getPackage(config, 'newpkg', { maxWaitMs: 5000 })

    expect(result).toEqual({ state: 'scored', package: { name: 'newpkg' } })
    expect(mockFetch).toHaveBeenCalledTimes(3)
    // every poll hits the same GET /packages/:name path, never /packages/crawl/:job_id
    for (const call of mockFetch.mock.calls) {
      expect(String(call[0])).toContain('/packages/newpkg')
      expect(String(call[0])).not.toContain('/packages/crawl/')
    }
  })

  it('returns still_crawling with the job id once maxWaitMs is exceeded', async () => {
    const mockFetch = vi.mocked(fetch)
    // Use a factory (not mockResolvedValue with a single shared Response) because getPackage
    // may poll more than once before the deadline is hit, and a Response body can only be
    // read once — reusing the same instance across calls would silently yield an empty body.
    mockFetch.mockImplementation(async () => jsonResponse(202, { status: 'crawling', job_id: 'job-2', retry_after_seconds: 1 }))

    const result = await getPackage(config, 'slowpkg', { maxWaitMs: 10 })

    expect(result).toEqual({ state: 'still_crawling', jobId: 'job-2' })
  })
})

describe('requestCrawl', () => {
  it('POSTs language and packages, returns the enqueue response on 202', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(jsonResponse(202, { job_id: 'job-3', queued: 2 }))

    const result = await requestCrawl(config, { language: 'javascript', packages: ['axios', 'zod'] })

    expect(result).toEqual({ job_id: 'job-3', queued: 2 })
    const [url, init] = mockFetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.packagerating.example/packages/crawl')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ language: 'javascript', packages: ['axios', 'zod'] })
  })

  it('throws PackageRatingApiError on a 400 validation error', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(jsonResponse(400, { error: 'packages must be a non-empty array of strings' }))

    await expect(requestCrawl(config, { language: 'javascript', packages: [] })).rejects.toMatchObject({
      message: 'packages must be a non-empty array of strings',
      status: 400,
    })
  })
})
