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
