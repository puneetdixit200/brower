import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  OnboardingPrivacyGate,
  PRIVACY_CHECKPOINTS,
} from './OnboardingPrivacyGate'

const providerActions = createElement(
  'div',
  null,
  createElement('button', { type: 'button' }, 'Add OpenAI'),
  createElement('button', { type: 'button' }, 'Add coding agent'),
)

function render(acknowledgedSteps: number) {
  return renderToStaticMarkup(
    createElement(OnboardingPrivacyGate, {
      acknowledgedSteps,
      onAcknowledge: () => {},
      onImportData: () => {},
      providerSetup: providerActions,
    }),
  )
}

describe('OnboardingPrivacyGate', () => {
  it('renders only the current checkpoint and withholds every provider action until all are acknowledged', () => {
    for (const [index, checkpoint] of PRIVACY_CHECKPOINTS.entries()) {
      const html = render(index)

      expect(html).toContain(
        `Checkpoint ${index + 1} of ${PRIVACY_CHECKPOINTS.length}`,
      )
      expect(html).toContain(checkpoint.title)
      expect(html).not.toContain('Connect a provider or coding agent')
      expect(html).not.toContain('Add OpenAI')
      expect(html).not.toContain('Add coding agent')
      expect(html).not.toContain('Open Chromium import settings')
    }
  })

  it('renders provider setup and its add actions after the final acknowledgement', () => {
    const html = render(PRIVACY_CHECKPOINTS.length)

    expect(html).toContain('Connect a provider or coding agent')
    expect(html).toContain('Add OpenAI')
    expect(html).toContain('Add coding agent')
    expect(html).not.toContain('Before you connect an AI provider')
    expect(html).toContain('Import browser data (optional)')
    expect(html).toContain('Open Chromium import settings')
    expect(html).toContain('native setup owns the profile location')
    expect(html).toContain('cannot set or change its path')
  })
})
