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
