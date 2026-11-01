import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import type { PageManager } from './pages'

const LOAD_TIMEOUT_MS = 30_000
/** Maximum navigation wait, preventing caller-supplied values from creating unbounded polling. */
export const MAX_LOAD_TIMEOUT_MS = 120_000

export function normalizeLoadTimeoutMs(timeout: number): number {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new RangeError(
      'Navigation load timeout must be a finite positive number.',
    )
  }
  return Math.min(timeout, MAX_LOAD_TIMEOUT_MS)
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

type DeadlineOutcome<T> =
  | { type: 'result'; value: T }
  | { type: 'error'; error: unknown }
  | { type: 'timeout' }

async function resolveBeforeDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T | null> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) return null

  let timer: ReturnType<typeof setTimeout> | undefined
  const pending: Promise<DeadlineOutcome<T>> = Promise.resolve(
    operation(),
  ).then(
    (value) => ({ type: 'result', value }),
    (error: unknown) => ({ type: 'error', error }),
  )
  const timeout = new Promise<DeadlineOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ type: 'timeout' }), remainingMs)
  })

  let outcome: DeadlineOutcome<T>
  try {
    outcome = await Promise.race([pending, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }

  if (outcome.type === 'timeout') return null
  if (outcome.type === 'error') throw outcome.error
  return outcome.value
}

async function evaluateBeforeDeadline(
  session: ProtocolApi,
  deadline: number,
  expression = 'document.readyState',
  awaitPromise = false,
): Promise<Awaited<ReturnType<ProtocolApi['Runtime']['evaluate']>> | null> {
  return resolveBeforeDeadline(
    () =>
      session.Runtime.evaluate({
        expression,
        ...(awaitPromise ? { awaitPromise } : {}),
        returnByValue: true,
      }),
    deadline,
  )
}

/** Polls readyState until the document is complete (or times out). */
async function waitForLoad(
  session: ProtocolApi,
  timeout = LOAD_TIMEOUT_MS,
  deadline = Date.now() + timeout,
): Promise<void> {
  const initialDelayMs = Math.min(50, Math.max(0, deadline - Date.now()))
  if (initialDelayMs > 0) await delay(initialDelayMs)
  while (Date.now() < deadline) {
    try {
      const result = await evaluateBeforeDeadline(session, deadline)
      if (result === null) break
      if (result.result?.value === 'complete') return
    } catch {
      // Execution context torn down mid-navigation — expected; keep polling.
    }
    const remainingMs = deadline - Date.now()
    if (remainingMs > 0) await delay(Math.min(150, remainingMs))
  }
  throw new Error(
    `Navigation timed out after ${timeout} ms after dispatch; the page may still change. Inspect the page before retrying.`,
  )
}

/** Navigation for a single page: url / reload / back / forward, each awaiting load. */
export class Navigation {
  private readonly loadTimeoutMs: number

  constructor(
    private readonly pages: PageManager,
    private readonly pageId: number,
    loadTimeoutMs = LOAD_TIMEOUT_MS,
  ) {
    this.loadTimeoutMs = normalizeLoadTimeoutMs(loadTimeoutMs)
  }

  private timeoutError(commandDispatched = false): Error {
    return new Error(
      commandDispatched
        ? `Navigation timed out after ${this.loadTimeoutMs} ms after dispatch; the page may still change. Inspect the page before retrying.`
        : `Navigation timed out after ${this.loadTimeoutMs} ms before a navigation command was dispatched.`,
    )
  }

  async goto(url: string): Promise<void> {
    const deadline = Date.now() + this.loadTimeoutMs
    const page = await resolveBeforeDeadline(
      () => this.pages.getSession(this.pageId),
      deadline,
    )
    if (page === null) throw this.timeoutError()
    const dispatched = await resolveBeforeDeadline(
      () => page.session.Page.navigate({ url }),
      deadline,
    )
    if (dispatched === null) throw this.timeoutError(true)
    await waitForLoad(page.session, this.loadTimeoutMs, deadline)
  }

  async reload(): Promise<void> {
    const deadline = Date.now() + this.loadTimeoutMs
    const page = await resolveBeforeDeadline(
      () => this.pages.getSession(this.pageId),
      deadline,
    )
    if (page === null) throw this.timeoutError()
    const dispatched = await resolveBeforeDeadline(
      () => page.session.Page.reload(),
      deadline,
    )
    if (dispatched === null) throw this.timeoutError(true)
    await waitForLoad(page.session, this.loadTimeoutMs, deadline)
  }

  async back(): Promise<void> {
    await this.history('back')
  }

  async forward(): Promise<void> {
    await this.history('forward')
  }

  private async history(direction: 'back' | 'forward'): Promise<void> {
    const deadline = Date.now() + this.loadTimeoutMs
    const page = await resolveBeforeDeadline(
      () => this.pages.getSession(this.pageId),
      deadline,
    )
    if (page === null) throw this.timeoutError()
    const result = await evaluateBeforeDeadline(
      page.session,
      deadline,
      `history.${direction}()`,
      true,
    )
    if (result === null) {
      throw this.timeoutError(true)
    }
    await waitForLoad(page.session, this.loadTimeoutMs, deadline)
  }
}
