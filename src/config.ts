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
