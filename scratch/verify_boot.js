import { buildApp } from '../src/app.js'

async function runBootVerification() {
  console.log('=== FASTIFY BOOT VERIFICATION ===')
  try {
    const app = await buildApp()
    await app.ready()
    console.log('Fastify buildApp(): BOOT SUCCESSFUL')

    // Enumerate registered routes
    const routes = []
    const printTree = app.printRoutes({ commonPrefix: false })

    console.log('\n=== REGISTERED ROUTE TREE ===')
    console.log(printTree.substring(0, 3000)) // Output first 3000 chars

    // Check OpenAPI generation
    const swaggerSpec = app.swagger()
    console.log('\n=== OPENAPI SPEC CHECK ===')
    console.log(`OpenAPI Title: ${swaggerSpec?.info?.title}`)
    console.log(`OpenAPI Version: ${swaggerSpec?.info?.version}`)
    console.log(`OpenAPI Paths count: ${Object.keys(swaggerSpec?.paths || {}).length}`)

    await app.close()
    console.log('\nFastify instance closed cleanly.')
    process.exit(0)
  } catch (err) {
    console.error('Fastify boot failed:', err)
    process.exit(1)
  }
}

runBootVerification()
