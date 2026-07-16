import type { Config } from './config'
import type { CrawlEnqueueResponse, CrawlingStatus, PackageDetail, PackageSummary } from './types'
import { PackageRatingApiError } from './types'

async function request<T>(config: Config, path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      'x-api-key': config.apiKey,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const body = (await response.json().catch(() => ({}))) as T
  return { status: response.status, body }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (typeof obj['error'] === 'string') return obj['error']
    if (typeof obj['message'] === 'string') return obj['message']
  }
  return fallback
}

export interface ListPackagesParams {
  sort?: 'general_score' | 'automation_score' | 'risk_score' | 'name'
  order?: 'asc' | 'desc'
  limit?: number
  language?: 'javascript' | 'python'
}

export async function listPackages(config: Config, params: ListPackagesParams): Promise<PackageSummary[]> {
  const query = new URLSearchParams()
  if (params.sort) query.set('sort', params.sort)
  if (params.order) query.set('order', params.order)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.language) query.set('language', params.language)

  const { status, body } = await request<PackageSummary[] | { error: string }>(config, `/packages?${query.toString()}`)
  if (status !== 200) {
    throw new PackageRatingApiError(errorMessage(body, `Unexpected status ${status} from GET /packages`), status)
  }
  return body as PackageSummary[]
}

export interface GetPackageParams {
  version?: string
  language?: 'javascript' | 'python'
  /** Bound on total time spent polling a crawl-in-progress result. Defaults to 60s. */
  maxWaitMs?: number
}

export type GetPackageResult =
  | { state: 'scored'; package: PackageDetail }
  | { state: 'still_crawling'; jobId: string }

export async function getPackage(config: Config, name: string, params: GetPackageParams = {}): Promise<GetPackageResult> {
  const maxWaitMs = params.maxWaitMs ?? 60_000
  const query = new URLSearchParams()
  if (params.version) query.set('version', params.version)
  if (params.language) query.set('language', params.language)
  const path = `/packages/${encodeURIComponent(name)}?${query.toString()}`

  const deadline = Date.now() + maxWaitMs
  let lastJobId: string | undefined

  for (;;) {
    const { status, body } = await request<PackageDetail | CrawlingStatus | { error: string }>(config, path)

    if (status === 200) {
      return { state: 'scored', package: body as PackageDetail }
    }
    if (status === 404) {
      throw new PackageRatingApiError(errorMessage(body, `Package '${name}' not found`), 404)
    }
    if (status === 202) {
      const crawling = body as CrawlingStatus
      lastJobId = crawling.job_id
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        return { state: 'still_crawling', jobId: lastJobId }
      }
      const waitMs = Math.min(Math.max(crawling.retry_after_seconds * 1000, 1000), remaining)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      continue
    }
    throw new PackageRatingApiError(errorMessage(body, `Unexpected status ${status} from GET /packages/${name}`), status)
  }
}

export interface RequestCrawlParams {
  language: 'javascript' | 'python'
  packages: string[]
}

export async function requestCrawl(config: Config, params: RequestCrawlParams): Promise<CrawlEnqueueResponse> {
  const { status, body } = await request<CrawlEnqueueResponse | { error: string }>(config, '/packages/crawl', {
    method: 'POST',
    body: JSON.stringify(params),
  })
  if (status !== 202) {
    throw new PackageRatingApiError(errorMessage(body, `Unexpected status ${status} from POST /packages/crawl`), status)
  }
  return body as CrawlEnqueueResponse
}
