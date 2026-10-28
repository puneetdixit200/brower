import { describe, expect, it } from 'bun:test'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { captureScreenshotWithAnnotations } from './screenshot'
import { installScreenshotFieldMask } from './screenshot-field-mask'

const SENTINEL = 'AUTOFILLED_SECRET_SENTINEL_7d93'

describe('screenshot editable-value mask', () => {
  it('masks revealed text inputs, textareas, editable text, and hides inaccessible frames', async () => {
    let expression = ''
    const session = {
      DOM: {
        getDocument: async () => ({
          root: { nodeType: 9, nodeName: '#document' },
        }),
      },
      Runtime: {
        evaluate: async (params: { expression: string }) => {
          expression = params.expression
          return { result: { value: true } }
        },
      },
    } as unknown as ProtocolApi

    await installScreenshotFieldMask(session, 'mask-test-token')

    expect(expression).toContain('input,textarea,select')
    expect(expression).toContain('input::placeholder,textarea::placeholder')
    expect(expression).toContain('-webkit-text-security:disc!important')
    expect(expression).toContain('[contenteditable] *')
    expect(expression).toContain('visibility:hidden!important')
    expect(expression).toContain('Closed custom-element shadow root')
    expect(expression).not.toContain(SENTINEL)
  })

  it('returns no screenshot bytes or metadata containing a field sentinel', async () => {
    const calls: string[] = []
    const pageSession = {
      DOM: {
        getDocument: async () => ({
          root: { nodeType: 9, nodeName: '#document' },
        }),
      },
      Runtime: {
        evaluate: async (params: { expression: string }) => {
          calls.push(params.expression)
          return { result: { value: true } }
        },
      },
      Page: {
        captureScreenshot: async () => {
          calls.push('capture')
          const masked = calls.some(
            (call) =>
              call.includes('-webkit-text-security:disc!important') &&
              call !== 'capture',
          )
          // This fixture models a visible autofilled field: capture leaks its sentinel
          // unless the masking expression ran first.
          return { data: masked ? 'iVBORw0KGgo=' : SENTINEL }
        },
      },
    } as unknown as ProtocolApi

    const result = await captureScreenshotWithAnnotations({
      pageSession,
      observer: {} as never,
      options: { format: 'png', annotate: false },
    })

    expect(calls[0]).toContain('-webkit-text-security:disc!important')
    expect(calls[1]).toBe('capture')
    expect(calls[2]).toContain('style[')
    expect(JSON.stringify(result)).not.toContain(SENTINEL)
    expect(result.data).toBe('iVBORw0KGgo=')
  })

  it('rejects instead of returning screenshot data when mask cleanup fails', async () => {
    let captures = 0
    let evaluations = 0
    const pageSession = {
      DOM: {
        getDocument: async () => ({
          root: { nodeType: 9, nodeName: '#document' },
        }),
      },
      Runtime: {
        evaluate: async (params: { expression: string }) => {
          evaluations += 1
          if (params.expression.includes("querySelectorAll('style['")) {
            return { exceptionDetails: { text: 'cleanup blocked' } }
          }
          return { result: { value: true } }
        },
      },
      Page: {
        captureScreenshot: async () => {
          captures += 1
          return { data: 'iVBORw0KGgo=' }
        },
      },
    } as unknown as ProtocolApi

    await expect(
      captureScreenshotWithAnnotations({
        pageSession,
        observer: {} as never,
        options: { format: 'png', annotate: false },
      }),
    ).rejects.toThrow('Unable to restore page styles')
    expect(captures).toBe(1)
    expect(evaluations).toBe(2)
  })

  it('fails closed without capturing when mask installation fails', async () => {
    let captured = false
    const pageSession = {
      DOM: {
        getDocument: async () => ({
          root: { nodeType: 9, nodeName: '#document' },
        }),
      },
      Runtime: {
        evaluate: async (params: { expression: string }) =>
          params.expression.includes('input,textarea,select')
            ? { exceptionDetails: { text: 'mask blocked' } }
            : { result: { value: true } },
      },
      Page: {
        captureScreenshot: async () => {
          captured = true
          return { data: SENTINEL }
        },
      },
    } as unknown as ProtocolApi

    await expect(
      captureScreenshotWithAnnotations({
        pageSession,
        observer: {} as never,
        options: { format: 'png', annotate: false },
      }),
    ).rejects.toThrow('Unable to mask editable values')
    expect(captured).toBe(false)
  })

  it('attempts mask cleanup when installation transport fails after a partial evaluation', async () => {
    const expressions: string[] = []
    let captured = false
    const pageSession = {
      DOM: {
        getDocument: async () => ({
          root: { nodeType: 9, nodeName: '#document' },
        }),
      },
      Runtime: {
        evaluate: async (params: { expression: string }) => {
          expressions.push(params.expression)
          if (params.expression.includes('input,textarea,select')) {
            throw new Error('transport failed after execution began')
          }
          return { result: { value: true } }
        },
      },
      Page: {
        captureScreenshot: async () => {
          captured = true
          return { data: SENTINEL }
        },
      },
    } as unknown as ProtocolApi

    await expect(
      captureScreenshotWithAnnotations({
        pageSession,
        observer: {} as never,
        options: { format: 'png', annotate: false },
      }),
    ).rejects.toThrow('transport failed after execution began')
    expect(expressions).toHaveLength(2)
    expect(expressions[1]).toContain('style[')
    expect(captured).toBe(false)
  })

  it('fails closed without capturing when CDP finds a closed shadow root', async () => {
    let captured = false
    const pageSession = {
      DOM: {
        getDocument: async () => ({
          root: {
            nodeType: 9,
            nodeName: '#document',
            children: [
              {
                nodeType: 1,
                nodeName: 'DIV',
                shadowRoots: [
                  {
                    nodeType: 11,
                    nodeName: '#document-fragment',
                    shadowRootType: 'closed',
                  },
                ],
              },
            ],
          },
        }),
      },
      Runtime: { evaluate: async () => ({ result: { value: true } }) },
      Page: {
        captureScreenshot: async () => {
          captured = true
          return { data: SENTINEL }
        },
      },
    } as unknown as ProtocolApi

    await expect(
      captureScreenshotWithAnnotations({
        pageSession,
        observer: {} as never,
        options: { format: 'png', annotate: false },
      }),
    ).rejects.toThrow('Closed shadow root')
    expect(captured).toBe(false)
  })
})
