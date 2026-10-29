type LoginTab = Pick<chrome.tabs.Tab, 'id' | 'url'> &
  Partial<Pick<chrome.tabs.Tab, 'active'>>
type LoginTabBrowser = {
  query: (query: { currentWindow: true }) => Promise<readonly LoginTab[]>
  update: (id: number, properties: { active: true }) => Promise<unknown>
}

/** Recognizes only the local dummy MFA fixture path; it never inspects page data. */
export function isLocalMfaFixtureUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') &&
      url.pathname === '/mfa-login.html'
    )
  } catch {
    return false
  }
}

export function continuationTabs<T extends LoginTab>(
  attachedTabs: readonly T[],
  currentWindowTabs: readonly T[],
): T[] {
  const eligible = (tabs: readonly LoginTab[]) =>
    tabs.filter(
      (tab) => tab.id !== undefined && /^https?:\/\//i.test(tab.url ?? ''),
    )
  const attachedIds = new Set(attachedTabs.map((tab) => tab.id))
  const currentAttached = eligible(currentWindowTabs).filter((tab) =>
    attachedIds.has(tab.id),
  )
  if (currentAttached.length) return currentAttached as T[]
  return eligible(currentWindowTabs.filter((tab) => tab.active)) as T[]
}

/** A new user turn; it cannot resume or automatically replay the stopped run. */
export function humanLoginContinuationPrompt(): string {
  return [
    'I completed the login or verification directly in the browser. Continue the original task as a fresh turn.',
    'First inspect the current browser state to confirm what is available and whether the task already completed.',
    'Please do not replay, retry, or submit any action from the preceding stopped run. This is an advisory request in a fresh turn, not a resume or an enforced guarantee. Do not ask me for, repeat, or include passwords, one-time codes, or passkey details.',
  ].join(' ')
}

/** Keeps the UI honest when the chat refuses a send; true may mean queued. */
export async function sendHumanLoginContinuation(
  send: (text: string) => boolean | Promise<boolean>,
): Promise<'accepted' | 'rejected'> {
  try {
    return (await send(humanLoginContinuationPrompt()))
      ? 'accepted'
      : 'rejected'
  } catch {
    return 'rejected'
  }
}

export function findAttachedLoginTab(
  currentWindowTabs: readonly LoginTab[],
  attachedTabs: readonly LoginTab[],
): LoginTab | undefined {
  return currentWindowTabs.find(
    (tab) =>
      tab.id !== undefined &&
      attachedTabs.some((attached) => attached.id === tab.id) &&
      /^https?:\/\//i.test(tab.url ?? ''),
  )
}

/** Stops the run before looking up or activating a user-owned login tab. */
export async function startHumanLoginHandoff(
  onStop: () => void,
  attachedTabs: readonly LoginTab[],
  tabs: LoginTabBrowser,
): Promise<boolean> {
  onStop()
  const currentWindowTabs = await tabs.query({ currentWindow: true })
  const eligible = findAttachedLoginTab(currentWindowTabs, attachedTabs)
  if (eligible?.id === undefined) return false
  await tabs.update(eligible.id, { active: true })
  return true
}
