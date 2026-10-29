import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import puppeteer from '/home/puneet/Projects/aster-browser/upstream-browseros/packages/browseros-agent/node_modules/.bun/puppeteer-core@25.12.0+a7296ceb8571f923/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'

const extensionDir =
  '/home/puneet/Projects/aster-browser/upstream-browseros/packages/browseros-agent/apps/app/dist/chrome-mv3-dev'
const profileDir = '/tmp/aster-b05-profile-cubyqgiy'
const downloadsDir = path.join(profileDir, 'Downloads')
const evidenceDir = '/tmp/aster-b05-evidence-20261030'
const logPath = path.join(evidenceDir, 'smoke.log')
const jsonPath = path.join(evidenceDir, 'result.json')
const fixtureFilename = 'aster-b05-verified.bin'
const fixtureSize = 24 * 1024 * 1024
const fixtureBlock = Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 251))
const sourceHashes = {
  'screens/agent-command/BrowserQuickControls.tsx': '4c3602899ea0158951349f38f4e2db7fc2f15e42789c2d86262e237a5e25af06',
  'screens/agent-command/downloads-progress.ts': '0393a5da23d13c2423f66a0b396c878892497e10ecaeed8ae6af00cd80244413',
  'screens/agent-command/downloads-progress.test.ts': '86bed8fec60b533671ac0bef6a2832a7f20841ba33667311ab747433aa296d51',
  'dist/chrome-mv3-dev/chunks/app-DpyJiIoq.js': 'abf7aa4d7db1e7451368e5626b8bba45abf014ee4bc8abf93265433510f1d926',
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const events = []
let browser
let server
let appPage
let downloadId
let completion = 'not_started'

fs.mkdirSync(evidenceDir, { recursive: true })
fs.mkdirSync(downloadsDir, { recursive: true })
fs.writeFileSync(logPath, '')

function record(event, data = {}) {
  const entry = { at: new Date().toISOString(), event, ...data }
  events.push(entry)
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`)
  process.stdout.write(`${JSON.stringify(entry)}\n`)
}

function extensionId() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'),
  )
  const hex = crypto
    .createHash('sha256')
    .update(Buffer.from(manifest.key, 'base64'))
    .digest('hex')
    .slice(0, 32)
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join('')
}

const serverPromise = new Promise((resolve, reject) => {
  server = http.createServer((request, response) => {
    if (request.url !== '/slow.bin') {
      response.writeHead(404).end()
      return
    }
    const range = request.headers.range
    const start = range?.startsWith('bytes=')
      ? Number.parseInt(range.slice(6).split('-', 1)[0], 10)
      : 0
    response.writeHead(start ? 206 : 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fixtureFilename}"`,
      'Content-Length': fixtureSize - start,
      'Accept-Ranges': 'bytes',
      ...(start
        ? { 'Content-Range': `bytes ${start}-${fixtureSize - 1}/${fixtureSize}` }
        : {}),
    })
    let sent = start
    let closed = false
    response.on('close', () => { closed = true })
    const send = () => {
      if (closed) return
      if (sent >= fixtureSize) {
        response.end()
        return
      }
      const chunk = fixtureBlock.subarray(0, Math.min(fixtureBlock.length, fixtureSize - sent))
      if (!response.write(chunk)) {
        response.once('drain', () => setTimeout(send, 60))
        sent += chunk.length
        return
      }
      sent += chunk.length
      setTimeout(send, 60)
    }
    send()
  })
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(server.address().port))
})

async function currentDownload() {
  return appPage.evaluate(async (name) => {
    const items = await chrome.downloads.search({ orderBy: ['-startTime'] })
    return items.find((item) => item.filename.endsWith(name)) || null
  }, fixtureFilename)
}

async function waitFor(predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await wait(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function capture(label, item) {
  await appPage.$eval('ul[aria-label="Recent downloads"]', (node) =>
    node.scrollIntoView({ block: 'center' }),
  )
  const screenshotPath = path.join(evidenceDir, `${label}.png`)
  await appPage.screenshot({ path: screenshotPath })
  record('ui_snapshot', {
    label,
    item,
    visibleRows: await appPage.$eval(
      'ul[aria-label="Recent downloads"]',
      (node) => node.innerText,
    ),
    screenshotPath,
  })
}

try {
  const port = await serverPromise
  const id = extensionId()
  browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: false,
    userDataDir: profileDir,
    defaultViewport: { width: 1280, height: 900 },
    timeout: 20000,
    args: [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--ozone-platform=x11',
      `--load-extension=${extensionDir}`,
      `--disable-extensions-except=${extensionDir}`,
    ],
  })
  const spawnArgs = browser.process().spawnargs
  if (spawnArgs.some((arg) => arg.includes('no-sandbox') || arg.includes('disable-setuid-sandbox'))) {
    throw new Error('Sandbox flag audit rejected the Chromium argv')
  }
  record('browser_started', {
    executable: '/usr/bin/chromium',
    version: (await browser.version()),
    argv: spawnArgs,
    profileDir,
    downloadsDir,
    extensionDir,
    extensionId: id,
    fixtureUrl: `http://127.0.0.1:${port}/slow.bin`,
    cdp: 'Puppeteer WebSocket transport; loopback ephemeral port; no remote-allow-origins flag',
    sourceHashes,
  })

  const sandboxPage = await browser.newPage()
  await sandboxPage.goto('chrome://sandbox')
  record('sandbox_status', {
    url: sandboxPage.url(),
    text: await sandboxPage.$eval('body', (node) => node.innerText),
  })
  await sandboxPage.close()

  const browserCdp = await browser.target().createCDPSession()
  await browserCdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadsDir,
    eventsEnabled: true,
  })
  record('download_path_set', { downloadsDir })

  appPage = await browser.newPage()
  appPage.on('pageerror', (error) => record('page_error', { message: error.message }))
  await appPage.goto(`chrome-extension://${id}/app.html#/home`)
  await appPage.waitForSelector('button[aria-label="Downloads"]', { timeout: 15000 })
  await appPage.evaluate(() => {
    const title = [...document.querySelectorAll('*')].find(
      (node) => node.childElementCount === 0 && node.textContent === 'Import your data',
    )
    title?.parentElement?.parentElement?.querySelector('button')?.click()
    document.querySelector('button[aria-label="Downloads"]')?.click()
  })

  const trigger = await browser.newPage()
  await trigger
    .goto(`http://127.0.0.1:${port}/slow.bin`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    })
    .catch((error) => record('download_navigation', { result: error.message.split('\n')[0] }))

  let item = await waitFor(async () => {
    const value = await currentDownload()
    return value?.state === 'in_progress' && value.bytesReceived > 300000 ? value : null
  }, 'synthetic download progress')
  downloadId = item.id
  record('download_started', { item })
  await capture('in-progress', item)

  const pauseButton = await appPage.$(`button[aria-label="Pause ${fixtureFilename}"]`)
  if (!pauseButton) throw new Error('Pause control was not rendered')
  await pauseButton.click()
  item = await waitFor(async () => {
    const value = await currentDownload()
    return value?.paused ? value : null
  }, 'paused state')
  const pausedBytes = item.bytesReceived
  record('download_paused', { item })
  await capture('paused', item)

  const resumeButton = await appPage.$(`button[aria-label="Resume ${fixtureFilename}"]`)
  if (!resumeButton) throw new Error('Resume control was not rendered')
  await resumeButton.click()
  item = await waitFor(async () => {
    const value = await currentDownload()
    return value && !value.paused && value.bytesReceived > pausedBytes ? value : null
  }, 'resumed byte progress')
  record('download_resumed', { item, bytesAtPause: pausedBytes })
  await capture('resumed', item)

  const cancelButton = await appPage.$(`button[aria-label="Cancel ${fixtureFilename}"]`)
  if (!cancelButton) throw new Error('Cancel control was not rendered')
  await cancelButton.click()
  item = await waitFor(async () => {
    const value = await currentDownload()
    return value && value.state === 'interrupted' && value.error === 'USER_CANCELED'
      ? value
      : null
  }, 'canceled state')
  record('download_canceled', { item })
  await capture('canceled', item)
  completion = 'passed'
} catch (error) {
  completion = 'failed'
  record('smoke_error', { message: error?.stack || String(error) })
} finally {
  if (browser && downloadId !== undefined && appPage) {
    try {
      const item = await appPage.evaluate((id) => chrome.downloads.search({ id }), downloadId)
      const current = item[0]
      if (current?.state === 'in_progress') await appPage.evaluate((id) => chrome.downloads.cancel(id), downloadId)
      if (current?.state === 'complete') await appPage.evaluate((id) => chrome.downloads.removeFile(id), downloadId)
    } catch (error) {
      record('fixture_cleanup_note', { message: String(error) })
    }
  }
  if (browser) await browser.close().catch(() => {})
  if (server) await new Promise((resolve) => server.close(resolve))
  fs.rmSync(profileDir, { recursive: true, force: true })
  record('cleanup_complete', { profileDir, evidenceDir, completion })
  fs.writeFileSync(jsonPath, JSON.stringify({ completion, events }, null, 2))
}

if (completion !== 'passed') process.exitCode = 1
