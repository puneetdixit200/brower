import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const evidenceRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(evidenceRoot, '../../../../..')
const require = createRequire(
  path.join(repoRoot, 'packages/browseros-agent/package.json'),
)
let puppeteer
try {
  puppeteer = require('puppeteer-core')
} catch {
  const bunStore = path.join(
    repoRoot,
    'packages/browseros-agent/node_modules/.bun',
  )
  const packageDir = fs
    .readdirSync(bunStore)
    .find((entry) => entry.startsWith('puppeteer-core@'))
  if (!packageDir)
    throw new Error('Could not resolve puppeteer-core from the workspace')
  const entry = path.join(
    bunStore,
    packageDir,
    'node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js',
  )
  puppeteer = (await import(pathToFileURL(entry).href)).default
}
const extensionDir = path.join(
  repoRoot,
  'packages/browseros-agent/apps/app/dist/chrome-mv3-dev',
)
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-b05-profile-'))
const downloadsDir = path.join(profileDir, 'Downloads')
const evidenceDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'aster-b05-evidence-'),
)
const logPath = path.join(evidenceDir, 'smoke.log')
const jsonPath = path.join(evidenceDir, 'result.json')
const fixtureFilename = `aster-b05-${process.pid}-${Date.now()}.bin`
const fixtureSize = 24 * 1024 * 1024
const fixtureBlock = Buffer.from(
  Array.from({ length: 65536 }, (_, i) => i % 251),
)
const sourceFiles = [
  [
    'screens/agent-command/BrowserQuickControls.tsx',
    path.join(
      repoRoot,
      'packages/browseros-agent/apps/app/screens/agent-command/BrowserQuickControls.tsx',
    ),
  ],
  [
    'screens/agent-command/downloads-progress.ts',
    path.join(
      repoRoot,
      'packages/browseros-agent/apps/app/screens/agent-command/downloads-progress.ts',
    ),
  ],
  [
    'screens/agent-command/downloads-progress.test.ts',
    path.join(
      repoRoot,
      'packages/browseros-agent/apps/app/screens/agent-command/downloads-progress.test.ts',
    ),
  ],
]
const appBundlePath = fs
  .readdirSync(path.join(extensionDir, 'chunks'))
  .filter((name) => /^app-.*\.js$/.test(name))
  .map((name) => path.join(extensionDir, 'chunks', name))
  .find((candidate) => fs.statSync(candidate).isFile())
if (!appBundlePath)
  throw new Error('Could not find built app bundle in extension chunks')
const sha256 = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex')
const sourceHashes = Object.fromEntries([
  ...sourceFiles.map(([label, filename]) => [
    label,
    sha256(fs.readFileSync(filename)),
  ]),
  [
    path.relative(repoRoot, appBundlePath),
    sha256(fs.readFileSync(appBundlePath)),
  ],
])
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const events = []
let browser
let browserLaunchPromise
let lateBrowserClosePromise
let server
let appPage
let downloadId
let completion = 'not_started'
let cleanupPromise
let signalReceived = false
let cleanupStarted = false

fs.mkdirSync(evidenceDir, { recursive: true })
fs.mkdirSync(downloadsDir, { recursive: true })

function record(event, data = {}) {
  const entry = { at: new Date().toISOString(), event, ...data }
  events.push(entry)
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`)
  process.stdout.write(`${JSON.stringify(entry)}\n`)
}

function ownedChromePids() {
  return fs
    .readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number)
    .filter((pid) => {
      try {
        return fs
          .readFileSync(`/proc/${pid}/cmdline`, 'utf8')
          .includes(`--user-data-dir=${profileDir}`)
      } catch {
        return false
      }
    })
}

async function terminateOwnedChromeProcesses() {
  for (const pid of ownedChromePids()) {
    record('owned_chrome_process_cleanup', { pid, signal: 'SIGTERM' })
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }
  const terminateDeadline = Date.now() + 2500
  while (Date.now() < terminateDeadline && ownedChromePids().length > 0)
    await wait(100)
  for (const pid of ownedChromePids()) {
    record('owned_chrome_process_cleanup', { pid, signal: 'SIGKILL' })
    try {
      if (ownedChromePids().includes(pid)) process.kill(pid, 'SIGKILL')
    } catch {}
  }
  const killDeadline = Date.now() + 3000
  while (Date.now() < killDeadline && ownedChromePids().length > 0)
    await wait(100)
  const remainingPids = ownedChromePids()
  if (remainingPids.length > 0) {
    record('owned_chrome_processes_remain', { pids: remainingPids, profileDir })
    return false
  }
  return true
}

async function cleanupResources() {
  if (cleanupPromise) return cleanupPromise
  cleanupStarted = true
  cleanupPromise = (async () => {
    if (browserLaunchPromise && !browser) {
      try {
        await bounded(
          'browser_launch_settle_during_cleanup',
          () =>
            browserLaunchPromise.then((launchedBrowser) => {
              browser = launchedBrowser
            }),
          21000,
        )
      } catch (error) {
        record('browser_launch_cleanup_note', { message: String(error) })
      }
    }
    if (lateBrowserClosePromise) {
      try {
        await bounded(
          'late_browser_close_wait',
          () => lateBrowserClosePromise,
          5500,
        )
      } catch (error) {
        record('late_browser_close_wait_note', { message: String(error) })
      }
    }
    if (browser && downloadId !== undefined && appPage) {
      try {
        const items = await bounded(
          'cleanup_search_task_download',
          () =>
            appPage.evaluate(
              (id) => chrome.downloads.search({ id }),
              downloadId,
            ),
          3000,
        )
        const current = items[0]
        if (current?.state === 'in_progress') {
          await bounded(
            'cleanup_cancel_task_download',
            () =>
              appPage.evaluate((id) => chrome.downloads.cancel(id), downloadId),
            3000,
          )
        }
        if (current?.state === 'complete') {
          await bounded(
            'cleanup_remove_task_download',
            () =>
              appPage.evaluate(
                (id) => chrome.downloads.removeFile(id),
                downloadId,
              ),
            3000,
          )
        }
      } catch (error) {
        record('fixture_cleanup_note', {
          message: error?.stack || String(error),
        })
      }
    }

    if (browser) {
      try {
        await bounded('browser_close', () => browser.close(), 5000)
      } catch (error) {
        record('browser_close_note', { message: String(error) })
      }
    }
    const chromeStopped = await terminateOwnedChromeProcesses()

    if (server) {
      try {
        await bounded(
          'fixture_server_close',
          () => new Promise((resolve) => server.close(resolve)),
          4000,
        )
      } catch (error) {
        record('fixture_server_close_note', { message: String(error) })
      }
    }
    if (chromeStopped) {
      fs.rmSync(profileDir, { recursive: true, force: true })
    } else {
      record('profile_preserved_for_live_owned_process', { profileDir })
    }
    record('cleanup_complete', {
      profileDir,
      evidenceDir,
      completion,
      chromeStopped,
    })
    fs.writeFileSync(jsonPath, JSON.stringify({ completion, events }, null, 2))
  })()
  return cleanupPromise
}

for (const [signal, exitCode] of [
  ['SIGTERM', 143],
  ['SIGINT', 130],
]) {
  process.once(signal, () => {
    signalReceived = true
    completion = 'terminated'
    record('signal_received', { signal })
    void cleanupResources()
      .catch((error) =>
        record('signal_cleanup_error', { message: String(error) }),
      )
      .finally(() => process.exit(exitCode))
  })
}

async function bounded(label, operation, timeoutMs = 5000) {
  record('stage_start', { label, timeoutMs })
  let timer
  try {
    const result = await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
    record('stage_complete', { label })
    return result
  } catch (error) {
    record('stage_failed', { label, message: error?.stack || String(error) })
    throw error
  } finally {
    clearTimeout(timer)
  }
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
  return [...hex]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('')
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
        ? {
            'Content-Range': `bytes ${start}-${fixtureSize - 1}/${fixtureSize}`,
          }
        : {}),
    })
    let sent = start
    let closed = false
    response.on('close', () => {
      closed = true
    })
    const send = () => {
      if (closed) return
      if (sent >= fixtureSize) {
        response.end()
        return
      }
      const offsetInBlock = sent % fixtureBlock.length
      const chunk = fixtureBlock.subarray(
        offsetInBlock,
        Math.min(fixtureBlock.length, offsetInBlock + fixtureSize - sent),
      )
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
  return bounded(
    'download_search',
    () =>
      appPage.evaluate(async (name) => {
        const items = await chrome.downloads.search({ orderBy: ['-startTime'] })
        return items.find((item) => item.filename.endsWith(name)) || null
      }, fixtureFilename),
    4000,
  )
}

async function waitFor(predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await bounded(
      `${label}_poll`,
      predicate,
      Math.max(1, deadline - Date.now()),
    )
    if (value) return value
    await wait(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function capture(label, item) {
  await bounded(`${label}_scroll`, () =>
    appPage.$eval('ul[aria-label="Recent downloads"]', (node) =>
      node.scrollIntoView({ block: 'center' }),
    ),
  )
  const screenshotPath = path.join(evidenceDir, `${label}.png`)
  await bounded(
    `${label}_screenshot`,
    () => appPage.screenshot({ path: screenshotPath }),
    8000,
  )
  record('ui_snapshot', {
    label,
    item,
    visibleRows: await bounded(`${label}_read_rows`, () =>
      appPage.$eval(
        'ul[aria-label="Recent downloads"]',
        (node) => node.innerText,
      ),
    ),
    screenshotPath,
  })
}

try {
  const port = await bounded('fixture_server_listen', () => serverPromise, 5000)
  const id = extensionId()
  browserLaunchPromise = puppeteer.launch({
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
  browserLaunchPromise.then(
    (lateBrowser) => {
      if (!cleanupStarted && completion !== 'failed' && !signalReceived) return
      browser = lateBrowser
      lateBrowserClosePromise = bounded(
        'late_browser_close',
        () => lateBrowser.close(),
        5000,
      ).catch((error) => {
        record('late_browser_close_note', { message: String(error) })
      })
    },
    () => {},
  )
  browser = await bounded('browser_launch', () => browserLaunchPromise, 25000)
  const spawnArgs = browser.process().spawnargs
  if (
    spawnArgs.some(
      (arg) =>
        arg.includes('no-sandbox') || arg.includes('disable-setuid-sandbox'),
    )
  ) {
    throw new Error('Sandbox flag audit rejected the Chromium argv')
  }
  record('browser_started', {
    executable: '/usr/bin/chromium',
    version: await bounded('browser_version', () => browser.version()),
    argv: spawnArgs,
    profileDir,
    downloadsDir,
    extensionDir,
    extensionId: id,
    fixtureUrl: `http://127.0.0.1:${port}/slow.bin`,
    cdp: 'Puppeteer WebSocket transport; loopback ephemeral port; no remote-allow-origins flag',
    sourceHashes,
  })

  const sandboxPage = await bounded('sandbox_page_create', () =>
    browser.newPage(),
  )
  await bounded('sandbox_page_goto', () => sandboxPage.goto('chrome://sandbox'))
  const sandboxText = await bounded('sandbox_status_read', () =>
    sandboxPage.$eval('body', (node) => node.innerText),
  )
  const requiredSandboxEvidence = [
    'PID namespaces\tYes',
    'Network namespaces\tYes',
    'Seccomp-BPF sandbox\tYes',
    'You are adequately sandboxed.',
  ]
  const missingSandboxEvidence = requiredSandboxEvidence.filter(
    (entry) => !sandboxText.includes(entry),
  )
  record('sandbox_status', {
    url: sandboxPage.url(),
    text: sandboxText,
    passed: missingSandboxEvidence.length === 0,
    missing: missingSandboxEvidence,
  })
  if (missingSandboxEvidence.length > 0) {
    throw new Error(
      `Chromium sandbox status missing required evidence: ${missingSandboxEvidence.join(', ')}`,
    )
  }
  await bounded('sandbox_page_close', () => sandboxPage.close())

  const browserCdp = await bounded('cdp_session_create', () =>
    browser.target().createCDPSession(),
  )
  await bounded('download_path_set', () =>
    browserCdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadsDir,
      eventsEnabled: true,
    }),
  )
  record('download_path_set', { downloadsDir })

  appPage = await bounded('app_page_create', () => browser.newPage())
  appPage.on('pageerror', (error) =>
    record('page_error', { message: error.message }),
  )
  await bounded(
    'app_page_goto',
    () => appPage.goto(`chrome-extension://${id}/app.html#/home`),
    15000,
  )
  const loadedBundleHash = await bounded(
    'loaded_app_bundle_hash',
    () =>
      appPage.evaluate(async () => {
        const bundleUrl = [...document.scripts]
          .map((script) => script.src)
          .find((url) => /\/chunks\/app-[^/]+\.js(?:$|\?)/.test(url))
        if (!bundleUrl)
          throw new Error(
            'App bundle was not observed loading in the extension page',
          )
        const response = await fetch(bundleUrl)
        if (!response.ok)
          throw new Error(
            `Could not fetch loaded app bundle: ${response.status}`,
          )
        const digest = await crypto.subtle.digest(
          'SHA-256',
          await response.arrayBuffer(),
        )
        return {
          url: bundleUrl,
          sha256: [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(''),
        }
      }),
    5000,
  )
  const localBundleHash = sourceHashes[path.relative(repoRoot, appBundlePath)]
  if (loadedBundleHash.sha256 !== localBundleHash) {
    throw new Error(
      `Loaded bundle hash mismatch: disk=${localBundleHash}, page=${loadedBundleHash.sha256}`,
    )
  }
  record('loaded_bundle_verified', { ...loadedBundleHash, sourceHashes })
  await bounded(
    'downloads_control_wait',
    () =>
      appPage.waitForSelector('button[aria-label="Downloads"]', {
        timeout: 12000,
      }),
    13000,
  )
  await bounded('open_downloads_ui', () =>
    appPage.evaluate(() => {
      const title = [...document.querySelectorAll('*')].find(
        (node) =>
          node.childElementCount === 0 &&
          node.textContent === 'Import your data',
      )
      title?.parentElement?.parentElement?.querySelector('button')?.click()
      document.querySelector('button[aria-label="Downloads"]')?.click()
    }),
  )

  const trigger = await bounded('fixture_page_create', () => browser.newPage())
  await bounded(
    'fixture_download_navigation',
    () =>
      trigger
        .goto(`http://127.0.0.1:${port}/slow.bin`, {
          waitUntil: 'domcontentloaded',
          timeout: 10000,
        })
        .catch((error) =>
          record('download_navigation', {
            result: error.message.split('\n')[0],
          }),
        ),
    11000,
  )

  let item = await waitFor(async () => {
    const value = await currentDownload()
    return value?.state === 'in_progress' && value.bytesReceived > 300000
      ? value
      : null
  }, 'synthetic download progress')
  downloadId = item.id
  record('download_started', { item })
  await capture('in-progress', item)

  record('control_activation_method', {
    method: 'synthetic in-page DOM click',
    physicalPointerUXVerified: false,
  })
  const pauseButton = await bounded('pause_button_lookup', () =>
    appPage.$(`button[aria-label="Pause ${fixtureFilename}"]`),
  )
  if (!pauseButton) throw new Error('Pause control was not rendered')
  await bounded(
    'pause_button_dom_activation',
    () =>
      appPage.$eval(
        `button[aria-label="Pause ${fixtureFilename}"]`,
        (button) => {
          if (
            !(button instanceof HTMLButtonElement) ||
            !button.isConnected ||
            button.disabled
          )
            throw new Error('Pause button is not actionable')
          button.click()
        },
      ),
    2500,
  )
  item = await waitFor(async () => {
    const value = await currentDownload()
    return value?.paused ? value : null
  }, 'paused state')
  const pausedBytes = item.bytesReceived
  record('download_paused', { item })
  await capture('paused', item)

  const resumeButton = await bounded('resume_button_lookup', () =>
    appPage.$(`button[aria-label="Resume ${fixtureFilename}"]`),
  )
  if (!resumeButton) throw new Error('Resume control was not rendered')
  await bounded(
    'resume_button_dom_activation',
    () =>
      appPage.$eval(
        `button[aria-label="Resume ${fixtureFilename}"]`,
        (button) => {
          if (
            !(button instanceof HTMLButtonElement) ||
            !button.isConnected ||
            button.disabled
          )
            throw new Error('Resume button is not actionable')
          button.click()
        },
      ),
    2500,
  )
  item = await waitFor(async () => {
    const value = await currentDownload()
    return value && !value.paused && value.bytesReceived > pausedBytes
      ? value
      : null
  }, 'resumed byte progress')
  record('download_resumed', { item, bytesAtPause: pausedBytes })
  await capture('resumed', item)

  const cancelButton = await bounded('cancel_button_lookup', () =>
    appPage.$(`button[aria-label="Cancel ${fixtureFilename}"]`),
  )
  if (!cancelButton) throw new Error('Cancel control was not rendered')
  await bounded(
    'cancel_button_dom_activation',
    () =>
      appPage.$eval(
        `button[aria-label="Cancel ${fixtureFilename}"]`,
        (button) => {
          if (
            !(button instanceof HTMLButtonElement) ||
            !button.isConnected ||
            button.disabled
          )
            throw new Error('Cancel button is not actionable')
          button.click()
        },
      ),
    2500,
  )
  item = await waitFor(async () => {
    const value = await currentDownload()
    return value &&
      value.state === 'interrupted' &&
      value.error === 'USER_CANCELED'
      ? value
      : null
  }, 'canceled state')
  record('download_canceled', { item })
  await capture('canceled', item)
  completion = 'passed'
} catch (error) {
  completion = signalReceived ? 'terminated' : 'failed'
  record('smoke_error', { message: error?.stack || String(error) })
} finally {
  await cleanupResources()
}

if (completion !== 'passed') process.exitCode = 1
