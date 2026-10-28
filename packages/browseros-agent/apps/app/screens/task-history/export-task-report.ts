import type { ExecutionTaskRecord } from '@/lib/execution-history/types'
import { isSafeTaskForDisplay } from './task-history'

const MAX_EXPORTED_TEXT = 100_000
const MAX_STEPS = 500
const TICK = String.fromCharCode(96)

function plain(value: string | undefined): string {
  const safe = value?.trim() || '(not recorded)'
  return safe.length > 10_000 ? safe.slice(0, 10_000) + '… [truncated]' : safe
}

function textBlock(value: string | undefined): string {
  const safe = plain(value)
  const lengths = Array.from(
    safe.matchAll(new RegExp(TICK + '+', 'g')),
    (match) => match[0].length + 1,
  )
  const fence = TICK.repeat(Math.max(3, ...lengths))
  return fence + 'text\n' + safe + '\n' + fence
}

/** Local user-initiated report. Never include raw tool input/output. */
export function buildTaskReport(task: ExecutionTaskRecord): string {
  if (!isSafeTaskForDisplay(task)) {
    throw new Error(
      'This task cannot be exported because it contains credential-shaped text.',
    )
  }
  const lines = [
    '# Aster task report',
    '',
    'Exported locally at the user’s request. Raw tool inputs and outputs are omitted.',
    '',
    '## Summary',
    '',
    '- Task ID: ' + plain(task.id),
    '- Status: ' + task.status,
    '- Started: ' + plain(task.startedAt),
    '- Finished: ' + plain(task.completedAt),
    '- Actions: ' + task.actionCount,
    '- Approvals: ' + task.approvalCount,
    '- Denials: ' + task.deniedCount,
    '- Errors: ' + task.errorCount,
    '',
    '## Request',
    '',
    textBlock(task.promptText),
    '',
    '## Response preview',
    '',
    textBlock(task.responsePreview),
    '',
    '## Browser and tool steps',
  ]
  const ordered = [...task.steps].sort((a, b) => a.order - b.order)
  for (const step of ordered.slice(0, MAX_STEPS)) {
    lines.push(
      '',
      '### ' + plain(step.toolName) + ' (' + step.state + ')',
      '',
      '- Started: ' + plain(step.startedAt),
      '- Finished: ' + plain(step.completedAt),
      '',
      textBlock(step.previewText),
    )
  }
  if (ordered.length > MAX_STEPS) lines.push('', 'Additional steps omitted.')
  const result = lines.join('\n') + '\n'
  return result.length > MAX_EXPORTED_TEXT
    ? result.slice(0, MAX_EXPORTED_TEXT) + '\n\n[Report truncated.]\n'
    : result
}

/** Downloads only after direct user interaction; never uploads anything. */
export function downloadTaskReport(task: ExecutionTaskRecord): void {
  const report = buildTaskReport(task)
  const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download =
    'aster-task-' + task.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) + '.md'
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
