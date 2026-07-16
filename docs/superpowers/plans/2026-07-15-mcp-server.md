# packagerating MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@packagerating/mcp-server` — a local stdio MCP server that gives Claude (or any
MCP-compatible client) live, on-demand access to packagerating.com's package health/risk scores as
three tools: `list_packages`, `get_package`, `request_crawl`.

**Architecture:** A stateless TypeScript/Node 20 CLI, distributed as an npm package and run via
`npx -y @packagerating/mcp-server`. Every tool call is a direct HTTPS request to the already-live,
already-documented public API (`api.packagerating.com`) — no database, no persistent state. Built
on `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`). Auth is a single
`PACKAGERATING_API_KEY` environment variable, required at startup.

**Tech Stack:** TypeScript, Node 20, `@modelcontextprotocol/sdk` ^1.29.0, `zod` ^3.25, Vitest,
`@vercel/ncc` for single-file bundling (matching the sibling `packagerating/audit-dependencies`
repo's build approach).

## Global Constraints

- Three tools only, thin 1:1 mirrors of the REST API: `list_packages` → `GET /packages`,
  `get_package` → `GET /packages/:name`, `request_crawl` → `POST /packages/crawl`. No curated or
  composite tools (e.g. "evaluate this dependency") — that reasoning belongs in a future skill
  layered on top, per the design spec.
- `get_package` polls the crawl-on-miss case internally (bounded, default 60s total, honoring the
  API's `retry_after_seconds` between polls) so callers get one call → one final answer. Per the
  API's own documentation, this is done by **re-polling `GET /packages/:name` itself** — not the
  separate `GET /packages/crawl/:job_id` endpoint, whose `status` field never transitions to
  `"done"` in cloud mode (confirmed in `docs/api-reference.md` of the main `package-rating` repo)
  and is therefore not a reliable completion signal on its own.
- API errors (404, 429, any non-2xx) are surfaced as clear tool-result text, never swallowed or
  silently retried beyond the bounded crawl-poll.
- Missing `PACKAGERATING_API_KEY` fails fast at process startup with a message pointing to
  `https://packagerating.com`, not a silent no-op or a per-call failure.
- No live API calls in the unit test suite — all HTTP is mocked. A separate, secret-gated smoke
  test script exercises the real API and is not part of the default `npm test` run.
- Module system, tooling conventions, and CI shape mirror the sibling
  `packagerating/audit-dependencies` repo (CommonJS, `@vercel/ncc` single-file bundle, Vitest,
  GitHub Actions CI) for org-wide consistency.

---

### Task 1: Project scaffolding and config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface Config {
    apiKey: string
    baseUrl: string
  }
  export function loadConfig(env?: NodeJS.ProcessEnv): Config
  ```

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@packagerating/mcp-server",
  "version": "0.1.0",
  "private": false,
  "description": "MCP server exposing packagerating.com package health/risk scores as live tools for Claude and other agentic coding assistants",
  "main": "dist/index.js",
  "bin": {
    "packagerating-mcp-server": "dist/index.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "ncc build src/index.ts -o dist && chmod +x dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "smoke-test": "tsx scripts/smoke-test.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^20.19.42",
    "@vercel/ncc": "^0.38.3",
    "tsx": "^4.22.4",
    "typescript": "^5.9.3",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "lib"
  },
  "include": ["src", "tests", "scripts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
  },
})
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
lib/

.worktrees/
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `package-lock.json` created, `node_modules/` populated, no errors.

- [ ] **Step 6: Write the failing test for `loadConfig`**

Create `tests/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  it('reads PACKAGERATING_API_KEY and defaults the base URL', () => {
    const config = loadConfig({ PACKAGERATING_API_KEY: 'test-key' })
    expect(config).toEqual({ apiKey: 'test-key', baseUrl: 'https://api.packagerating.com' })
  })

  it('allows overriding the base URL via PACKAGERATING_API_BASE_URL', () => {
    const config = loadConfig({
      PACKAGERATING_API_KEY: 'test-key',
      PACKAGERATING_API_BASE_URL: 'https://staging.api.packagerating.com',
    })
    expect(config.baseUrl).toBe('https://staging.api.packagerating.com')
  })

  it('throws a clear error when PACKAGERATING_API_KEY is missing', () => {
    expect(() => loadConfig({})).toThrow(/PACKAGERATING_API_KEY/)
    expect(() => loadConfig({})).toThrow(/packagerating\.com/)
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config'` (module does not exist yet).

- [ ] **Step 8: Write `src/config.ts`**

```typescript
export interface Config {
  apiKey: string
  baseUrl: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env['PACKAGERATING_API_KEY']
  if (!apiKey) {
    throw new Error(
      'PACKAGERATING_API_KEY is not set. Get a free API key at https://packagerating.com, then set it in your MCP client config.',
    )
  }
  const baseUrl = env['PACKAGERATING_API_BASE_URL'] || 'https://api.packagerating.com'
  return { apiKey, baseUrl }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (3 tests, 0 failures).

- [ ] **Step 10: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/config.ts tests/config.test.ts
git commit -m "chore: scaffold project and add config loader"
```

---

### Task 2: API client

**Files:**
- Create: `src/types.ts`
- Create: `src/api-client.ts`
- Test: `tests/api-client.test.ts`

**Interfaces:**
- Consumes: `Config` from Task 1 (`src/config.ts`).
- Produces:
  ```typescript
  // types.ts
  export interface PackageSummary {
    name: string
    general_score: number
    automation_score: number
    risk_score: number
    scored_at: string
  }
  export interface PackageDetail {
    name: string
    version: string
    language: string
    registry: string
    registry_url: string
    github_url: string
    general_score: number
    automation_score: number
    risk_score: number
    scored_at: string
    dimensions: {
      liveness: number
      community: number
      security: number
      dependency: number
      versioning: number
      dep_risk: number
    }
    signals: Record<string, unknown>
  }
  export class PackageRatingApiError extends Error {
    constructor(message: string, public readonly status: number)
  }

  // api-client.ts
  export interface ListPackagesParams {
    sort?: 'general_score' | 'automation_score' | 'risk_score' | 'name'
    order?: 'asc' | 'desc'
    limit?: number
    language?: 'javascript' | 'python'
  }
  export function listPackages(config: Config, params: ListPackagesParams): Promise<PackageSummary[]>

  export interface GetPackageParams {
    version?: string
    language?: 'javascript' | 'python'
    maxWaitMs?: number
  }
  export type GetPackageResult =
    | { state: 'scored'; package: PackageDetail }
    | { state: 'still_crawling'; jobId: string }
  export function getPackage(config: Config, name: string, params?: GetPackageParams): Promise<GetPackageResult>

  export interface RequestCrawlParams {
    language: 'javascript' | 'python'
    packages: string[]
  }
  export interface CrawlEnqueueResponse {
    job_id: string
    queued: number
  }
  export function requestCrawl(config: Config, params: RequestCrawlParams): Promise<CrawlEnqueueResponse>
  ```

- [ ] **Step 1: Write `src/types.ts`**

```typescript
export interface PackageSummary {
  name: string
  general_score: number
  automation_score: number
  risk_score: number
  scored_at: string
}

export interface PackageDetail {
  name: string
  version: string
  language: string
  registry: string
  registry_url: string
  github_url: string
  general_score: number
  automation_score: number
  risk_score: number
  scored_at: string
  dimensions: {
    liveness: number
    community: number
    security: number
    dependency: number
    versioning: number
    dep_risk: number
  }
  signals: Record<string, unknown>
}

export interface CrawlingStatus {
  status: 'crawling'
  job_id: string
  retry_after_seconds: number
}

export interface CrawlEnqueueResponse {
  job_id: string
  queued: number
}

export class PackageRatingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'PackageRatingApiError'
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/api-client.test.ts`:

```typescript
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
    mockFetch.mockResolvedValue(jsonResponse(202, { status: 'crawling', job_id: 'job-2', retry_after_seconds: 1 }))

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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/api-client.test.ts`
Expected: FAIL — `Cannot find module '../src/api-client'` (module does not exist yet).

- [ ] **Step 4: Write `src/api-client.ts`**

```typescript
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
      const waitMs = Math.min(crawling.retry_after_seconds * 1000, remaining)
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/api-client.test.ts`
Expected: PASS (10 tests, 0 failures).

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/api-client.ts tests/api-client.test.ts
git commit -m "feat: add API client for list/get/crawl endpoints"
```

---

### Task 3: MCP tool handlers and server entry point

**Files:**
- Create: `src/tools.ts`
- Create: `src/index.ts`
- Test: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1), `listPackages`/`getPackage`/`requestCrawl`/`PackageRatingApiError` (Task 2).
- Produces:
  ```typescript
  export const listPackagesInputSchema: Record<string, ZodTypeAny>
  export const getPackageInputSchema: Record<string, ZodTypeAny>
  export const requestCrawlInputSchema: Record<string, ZodTypeAny>
  export function makeListPackagesHandler(config: Config): (args: {...}) => Promise<CallToolResult>
  export function makeGetPackageHandler(config: Config): (args: {...}) => Promise<CallToolResult>
  export function makeRequestCrawlHandler(config: Config): (args: {...}) => Promise<CallToolResult>
  ```
  Handlers are factory-returned functions (not registered directly against a live `McpServer` in
  this file) so tests can call them in isolation without spinning up a transport.

- [ ] **Step 1: Write the failing tests**

Create `tests/tools.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Config } from '../src/config'
import { PackageRatingApiError } from '../src/types'

const listPackagesMock = vi.fn()
const getPackageMock = vi.fn()
const requestCrawlMock = vi.fn()

vi.mock('../src/api-client', () => ({
  listPackages: (...args: unknown[]) => listPackagesMock(...args),
  getPackage: (...args: unknown[]) => getPackageMock(...args),
  requestCrawl: (...args: unknown[]) => requestCrawlMock(...args),
}))

const { makeListPackagesHandler, makeGetPackageHandler, makeRequestCrawlHandler } = await import('../src/tools')

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tools.test.ts`
Expected: FAIL — `Cannot find module '../src/tools'` (module does not exist yet).

- [ ] **Step 3: Write `src/tools.ts`**

```typescript
import { z } from 'zod'
import type { Config } from './config'
import { getPackage, listPackages, requestCrawl } from './api-client'
import { PackageRatingApiError } from './types'

interface ToolTextResult {
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/tools.test.ts`
Expected: PASS (7 tests, 0 failures).

- [ ] **Step 5: Write `src/index.ts`**

```typescript
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
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Build and manually verify the server starts**

Run: `npm run build`
Expected: `dist/index.js` created, executable.

Run: `PACKAGERATING_API_KEY=test node dist/index.js < /dev/null`
Expected: process starts and waits on stdin (an MCP server with no client attached just idles
reading stdin — this confirms it doesn't crash on startup with a valid key set). Press Ctrl+C to
stop it.

Run: `node dist/index.js < /dev/null`
Expected: prints the `PACKAGERATING_API_KEY is not set...` message to stderr and exits with a
non-zero code (no `PACKAGERATING_API_KEY` set this time).

- [ ] **Step 8: Commit**

```bash
git add src/tools.ts src/index.ts tests/tools.test.ts
git commit -m "feat: add MCP tool handlers and server entry point"
```

---

### Task 4: README and package metadata polish

**Files:**
- Create: `README.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

### Task 5: Live smoke test script and CI/release workflows

**Files:**
- Create: `scripts/smoke-test.ts`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/smoke-test.yml`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `listPackages`/`getPackage` (Task 2).

- [ ] **Step 1: Write `scripts/smoke-test.ts`**

This exercises the real `api.packagerating.com` API directly through the api-client module (not a
full MCP protocol round-trip — the actual risk surface worth testing live is "does our client
correctly parse real API responses," not the MCP transport layer, which is already covered by the
SDK's own tests). Requires a real `PACKAGERATING_API_KEY` in the environment.

```typescript
import { loadConfig } from '../src/config'
import { getPackage, listPackages } from '../src/api-client'

async function main(): Promise<void> {
  const config = loadConfig()

  console.log('Smoke test: list_packages...')
  const packages = await listPackages(config, { limit: 1 })
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error(`Expected at least one package from list_packages, got: ${JSON.stringify(packages)}`)
  }
  console.log(`  OK — got ${packages.length} package(s), first: ${packages[0]!.name}`)

  console.log('Smoke test: get_package for a well-known package (axios)...')
  const result = await getPackage(config, 'axios', { maxWaitMs: 30_000 })
  if (result.state !== 'scored') {
    throw new Error(`Expected axios to already be scored, got state: ${result.state}`)
  }
  if (typeof result.package.general_score !== 'number') {
    throw new Error(`Expected a numeric general_score, got: ${JSON.stringify(result.package)}`)
  }
  console.log(`  OK — axios general_score: ${result.package.general_score}`)

  console.log('All smoke tests passed.')
}

main().catch(err => {
  console.error('Smoke test FAILED:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
```

- [ ] **Step 2: Manually verify the smoke test script (if you have a real API key)**

Run: `PACKAGERATING_API_KEY=<a real key> npm run smoke-test`
Expected: both smoke tests print `OK` and the script exits 0. Skip this step if you don't have a
real key handy — CI will run it in Step 5 once the `PACKAGERATING_API_KEY` repo secret is set.

- [ ] **Step 3: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 4: Write `.github/workflows/smoke-test.yml`**

```yaml
name: Live Smoke Test

on:
  workflow_dispatch:
  release:
    types: [published]

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run smoke-test
        env:
          PACKAGERATING_API_KEY: ${{ secrets.PACKAGERATING_API_KEY }}
```

This requires a `PACKAGERATING_API_KEY` repository secret — a real, live API key — to be set
manually in the repo settings after this plan is executed (the same manual-secret-setup pattern
used for `PACKAGERATING_API_KEY` in the two sibling GitHub Action repos' own test/deploy
workflows). Not something an implementer can do from within this codebase; flag it in the final
report.

- [ ] **Step 5: Write `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - name: Create GitHub Release
        run: gh release create "${{ github.ref_name }}" --generate-notes
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This requires an `NPM_TOKEN` repository secret (an npm automation token with publish rights for
the `@packagerating` npm org/scope) to be set manually after this plan is executed — npm publish
credentials can't be created from within this codebase. Flag it in the final report, same as the
`PACKAGERATING_API_KEY` secret in Step 4.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-test.ts .github/workflows/ci.yml .github/workflows/smoke-test.yml .github/workflows/release.yml
git commit -m "ci: add CI, live smoke test, and npm release workflows"
```

---

## Self-Review Notes

- **Spec coverage:** all three tools (`list_packages`, `get_package`, `request_crawl`) from the
  spec's "Tools" section are implemented (Task 3); the crawl-on-miss internal-polling design
  (bounded, re-polling `GET /packages/:name` rather than the job-status endpoint) is implemented
  exactly as specified in Task 2, with a dedicated test proving it never calls
  `/packages/crawl/:job_id`; error handling matches the spec's "Error handling" section
  (structured text, no swallowing, no silent retry beyond the bounded poll) via `describeError`/
  `errorResult` in Task 3; the `PACKAGERATING_API_KEY` fail-fast-at-startup requirement is
  implemented in Task 1 (`loadConfig`) and wired into `main()` in Task 3; unit tests mock all HTTP
  (Tasks 2–3), and the live smoke test (Task 5) is a separate, secret-gated, non-default-`npm test`
  script, matching the spec's "Testing" section exactly.
- **Placeholder scan:** every step shows complete, real code — no TBDs. The two "requires a manual
  secret" notes (Task 5, Steps 4 and 5) are genuine external prerequisites outside any codebase's
  reach (npm/GitHub secret provisioning), not placeholders for missing design decisions — the
  workflows themselves are fully specified and correct once those secrets exist.
- **Type consistency:** `Config` (Task 1) is threaded unchanged through `api-client.ts` (Task 2)
  and `tools.ts`/`index.ts` (Task 3). `GetPackageResult`'s `{state: 'scored' | 'still_crawling'}`
  discriminated union (Task 2) is consumed correctly in `makeGetPackageHandler` (Task 3) via an
  exhaustive `if (result.state === 'still_crawling')` check. `PackageRatingApiError`'s `status`
  field (Task 2, `types.ts`) is read consistently in `describeError` (Task 3).
- **"Full Scope — Saved for Later" from the spec** (skills, subagent, GitHub-integration skill,
  Claude Code plugin, and the self-aware/self-update design principle for those future layers) is
  intentionally NOT part of this plan — it's documented in the spec precisely so it doesn't need
  to be re-derived when picked up later, and building it now would violate the explicitly agreed
  "MCP server first" scope decision from brainstorming.
- **No changes needed to the main `package-rating` repo or either GitHub Action repo** — this is a
  wholly new, independent repo that only calls the already-stable, already-public REST API. Not
  listed as a task.
