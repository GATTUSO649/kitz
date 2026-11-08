import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const terminalStatuses = new Map([
  ['live', 'success'],
  ['build_failed', 'failure'],
  ['update_failed', 'failure'],
  ['pre_deploy_failed', 'failure'],
  ['canceled', 'failure'],
])

function safeResponseError(operation, status) {
  return `${operation} failed with HTTP ${status}. Check the Render deployment logs.`
}

async function renderRequest(url, apiKey, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(safeResponseError('Render API request', response.status))
  return response.json()
}

async function waitForDeploy({ apiKey, serviceId, deployId, timeoutMs = 20 * 60_000 }) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const deploy = await renderRequest(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`, apiKey)
    const status = deploy.status ?? deploy.deploy?.status
    if (terminalStatuses.get(status) === 'success') return status
    if (terminalStatuses.get(status) === 'failure') throw new Error(`Render deployment ${deployId} ended with status ${status}.`)
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  throw new Error(`Render deployment ${deployId} did not finish within 20 minutes.`)
}

async function checkEndpoint(baseUrl, route, expected) {
  const response = await fetch(new URL(route, baseUrl), { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}.`)
  const body = await response.json().catch(() => ({}))
  if (!expected(body)) throw new Error(`${route} returned an unexpected health response.`)
  return 'passed'
}

async function main() {
  const apiKey = process.env.RENDER_API_KEY
  const serviceId = process.env.RENDER_MARKETHUB_SERVICE_ID
  const baseUrl = process.env.MARKETHUB_BASE_URL
  const commit = process.env.GITHUB_SHA
  const reportIndex = process.argv.indexOf('--report')
  const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : undefined
  if (!apiKey || !serviceId || !baseUrl) throw new Error('RENDER_API_KEY, RENDER_MARKETHUB_SERVICE_ID, and MARKETHUB_BASE_URL are required in the selected GitHub environment.')
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) throw new Error('GITHUB_SHA must be a full 40-character commit SHA.')
  const parsedBaseUrl = new URL(baseUrl)
  if (parsedBaseUrl.protocol !== 'https:') throw new Error('MARKETHUB_BASE_URL must use HTTPS.')

  const deployResponse = await renderRequest(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys`, apiKey, {
    method: 'POST',
    body: JSON.stringify({ clearCache: 'do_not_clear', commitId: commit }),
  })
  const deployId = deployResponse.id ?? deployResponse.deploy?.id
  if (typeof deployId !== 'string' || !deployId) throw new Error('Render accepted the deploy request without returning a deployment identifier.')
  process.stdout.write(`Render deployment started: ${deployId}\n`)
  const deployStatus = await waitForDeploy({ apiKey, serviceId, deployId })

  const health = {
    live: await checkEndpoint(baseUrl, '/health/live', (body) => body.status === 'ok'),
    ready: await checkEndpoint(baseUrl, '/health/ready', (body) => body.database === 'ok' && ['ready', 'degraded'].includes(body.status)),
    categories: await checkEndpoint(baseUrl, '/api/v1/marketplace/categories', (body) => Array.isArray(body.data)),
    products: await checkEndpoint(baseUrl, '/api/v1/marketplace/products?limit=1', (body) => Array.isArray(body.data)),
  }
  const report = {
    commit,
    serviceId,
    deployId,
    deployStatus,
    health,
    completedAt: new Date().toISOString(),
  }
  const markdown = [
    '# MarketHub Render Deployment',
    '',
    `- Commit SHA: ${commit}`,
    `- Render service ID: ${serviceId}`,
    `- Render deployment ID: ${deployId}`,
    `- Render status: ${deployStatus}`,
    `- Health: liveness ${health.live}; readiness ${health.ready}; categories ${health.categories}; products ${health.products}`,
    `- Completed: ${report.completedAt}`,
    '',
    'No database credentials or API tokens are included in this report.',
  ].join('\n') + '\n'
  if (reportPath) await writeFile(path.resolve(reportPath), markdown, 'utf8')
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' })
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `render_deploy_id=${deployId}\n`, { flag: 'a' })
  process.stdout.write(markdown)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure'
  process.stderr.write(`MarketHub deployment failed: ${message}\n`)
  process.exitCode = 1
})