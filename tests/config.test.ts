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
