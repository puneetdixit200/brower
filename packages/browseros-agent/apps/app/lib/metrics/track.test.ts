import { expect, it, mock } from 'bun:test'
import { track } from './track'

it('never forwards app events to the uncontrolled native metric API', () => {
  const logMetric = mock(() => {})
  globalThis.chrome = { browserOS: { logMetric } } as unknown as typeof chrome
  track('app.test', { prompt: 'sentinel private text' })
  expect(logMetric).not.toHaveBeenCalled()
})
