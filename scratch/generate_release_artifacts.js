import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.DISABLE_SOCKETIO = 'true'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACTS_DIR = path.join(__dirname, '..', 'artifacts')

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
}

async function generateArtifacts() {
  console.log('Generating Release Artifacts...')
  
  const { buildApp } = await import('../src/app.js')
  const { redis } = await import('../src/config/redis.js')
  const app = await buildApp()
  await app.ready()

  // 1. Generate routes.txt
  const routesTxt = app.printRoutes({ commonPrefix: false })
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'routes.txt'), routesTxt, 'utf8')
  console.log('✅ Generated artifacts/routes.txt')

  // 2. Generate openapi.json
  const openapiSpec = app.swagger()
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'openapi.json'), JSON.stringify(openapiSpec, null, 2), 'utf8')
  console.log('✅ Generated artifacts/openapi.json')

  await app.close()
  redis.disconnect()
  console.log('Done.')
  process.exit(0)
}

generateArtifacts().catch(console.error)
