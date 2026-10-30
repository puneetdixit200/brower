import { describe, expect, it } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { buildContentMarkdownExpression } from './content-markdown'

type FixtureNode = {
  nodeType: number
  tagName?: string
  childNodes: FixtureNode[]
  children: FixtureNode[]
  textContent?: string
  hidden?: boolean
  value?: string
  getAttribute: (name: string) => string | null
  querySelector: (selector: string) => FixtureNode | null
}

function text(value: string): FixtureNode {
  return {
    nodeType: 3,
    childNodes: [],
    children: [],
    textContent: value,
    getAttribute: () => null,
    querySelector: () => null,
  }
}

function element(tagName: string, children: FixtureNode[] = []): FixtureNode {
  return {
    nodeType: 1,
    tagName,
    childNodes: children,
    children,
    hidden: false,
    getAttribute: () => null,
    querySelector: () => null,
  }
}

describe('content markdown expression', () => {
  it('omits form-control sentinels while preserving visible page text', () => {
    const passwordSentinel = 'saved-password-sentinel-f19c'
    const textareaSentinel = 'textarea-form-control-sentinel-f19c'
    const password = element('INPUT')
    password.value = passwordSentinel
    const textarea = element('TEXTAREA', [text(textareaSentinel)])
    const body = element('BODY', [text('Welcome back'), password, textarea])
    const document = {
      body,
      querySelector: () => null,
    }
    const result = runInNewContext(buildContentMarkdownExpression({}), {
      document,
      window: { innerHeight: 800, innerWidth: 1200 },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    })

    expect(result).toContain('Welcome back')
    expect(result).not.toContain(passwordSentinel)
    expect(result).not.toContain(textareaSentinel)
  })
})
