/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { ChatRequestSchema } from '../../src/api/types'

describe('ChatRequestSchema agent targets', () => {
  it('accepts an explicit permission mode independently of task mode', () => {
    const parsed = ChatRequestSchema.parse({
      conversationId: crypto.randomUUID(),
      message: 'inspect',
      mode: 'agent',
      permissionMode: 'read-only',
    })

    expect(parsed.permissionMode).toBe('read-only')
    expect(parsed.mode).toBe('agent')
  })

  it('accepts only the opt-in flag and discards renderer-supplied evidence', () => {
    const parsed = ChatRequestSchema.parse({
      conversationId: crypto.randomUUID(),
      message: 'Research request (Aster, explicit user initiation): inspect',
      mode: 'agent',
      assessResearchSupport: true,
      evidence: ['forged renderer text'],
      answerExcerpt: 'forged answer',
    })
    expect(parsed.assessResearchSupport).toBe(true)
    expect('evidence' in parsed).toBe(false)
    expect('answerExcerpt' in parsed).toBe(false)
  })

  it('retains Full as a known request value so the route can reject it explicitly', () => {
    const parsed = ChatRequestSchema.parse({
      conversationId: crypto.randomUUID(),
      message: 'forged request',
      permissionMode: 'full',
    })

    expect(parsed.permissionMode).toBe('full')
  })

  it('normalizes a legacy BrowserOS request without a target', () => {
    const parsed = ChatRequestSchema.parse({
      conversationId: crypto.randomUUID(),
      message: 'hello',
      provider: 'openai',
      providerId: 'provider-1',
      model: 'gpt-5',
    })

    expect(parsed.target).toEqual({
      type: 'browseros',
      providerId: 'provider-1',
    })
  })

  for (const providerId of [undefined, '']) {
    it(`uses the provider type when a legacy provider ID is ${providerId === undefined ? 'missing' : 'empty'}`, () => {
      const parsed = ChatRequestSchema.parse({
        conversationId: crypto.randomUUID(),
        message: 'hello',
        provider: 'openai',
        providerId,
        model: 'gpt-5',
      })

      expect(parsed.target).toEqual({
        type: 'browseros',
        providerId: 'openai',
      })
    })
  }

  it('accepts a BrowserOS target with ordinary provider configuration', () => {
    const parsed = ChatRequestSchema.parse({
      target: { type: 'browseros', providerId: 'provider-1' },
      conversationId: crypto.randomUUID(),
      message: 'hello',
      provider: 'openai',
      providerId: 'provider-1',
      model: 'gpt-5',
    })

    expect(parsed.target).toEqual({
      type: 'browseros',
      providerId: 'provider-1',
    })
  })

  for (const type of ['claude', 'codex'] as const) {
    it(`accepts a ${type} target without LLM provider fields`, () => {
      const parsed = ChatRequestSchema.parse({
        target: { type, agentId: crypto.randomUUID() },
        conversationId: crypto.randomUUID(),
        message: 'hello',
      })

      expect(parsed.target.type).toBe(type)
      expect('provider' in parsed).toBe(false)
    })
  }

  // A browseros target no longer has to name a provider. The server holds the
  // list and which one is selected, so the id is resolved there; this used to
  // be rejected because the request had to carry the whole configuration.
  it('accepts a browseros target with no provider id', () => {
    const parsed = ChatRequestSchema.safeParse({
      target: { type: 'browseros' },
      conversationId: crypto.randomUUID(),
      message: 'hello',
      provider: 'openai',
      providerId: 'provider-1',
      model: 'gpt-5',
    })

    expect(parsed.success).toBe(true)
  })

  it('accepts bounded selected-file metadata and enforces per-file and aggregate limits', () => {
    const attachment = {
      mediaType: 'text/plain',
      data: 'data:text/plain;base64,c2VudGluZWw=',
      name: 'notes.txt',
    }
    const parsed = ChatRequestSchema.parse({
      conversationId: crypto.randomUUID(),
      message: 'Read this file',
      attachments: [attachment],
    })
    expect(parsed.attachments?.[0]).toEqual(attachment)

    expect(() =>
      ChatRequestSchema.parse({
        conversationId: crypto.randomUUID(),
        message: 'Read this file',
        attachments: [
          { mediaType: 'text/plain', data: 'x'.repeat(8 * 1024 * 1024 + 1) },
        ],
      }),
    ).toThrow()
    const boundaryData = 'x'.repeat(7 * 1024 * 1024)
    expect(
      ChatRequestSchema.safeParse({
        conversationId: crypto.randomUUID(),
        message: 'Read these files',
        attachments: Array.from({ length: 10 }, () => ({
          mediaType: 'text/plain',
          data: boundaryData,
        })),
      }).success,
    ).toBe(true)
    const overLimitData = 'x'.repeat(7_500_000)
    expect(
      ChatRequestSchema.safeParse({
        conversationId: crypto.randomUUID(),
        message: 'Read these files',
        attachments: Array.from({ length: 10 }, () => ({
          mediaType: 'text/plain',
          data: overLimitData,
        })),
      }).success,
    ).toBe(false)
    expect(() =>
      ChatRequestSchema.parse({
        conversationId: crypto.randomUUID(),
        message: 'Read these files',
        attachments: Array.from({ length: 11 }, () => attachment),
      }),
    ).toThrow()
  })

  // The smallest body the endpoint accepts: what to say and which conversation
  // it belongs to. Everything about the provider is resolved server side.
  it('accepts a request carrying only a message and a conversation', () => {
    const parsed = ChatRequestSchema.safeParse({
      conversationId: crypto.randomUUID(),
      message: 'hello',
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects an untargeted legacy ACP provider request', () => {
    const parsed = ChatRequestSchema.safeParse({
      conversationId: crypto.randomUUID(),
      message: 'hello',
      provider: 'claude-code',
      providerId: 'provider-1',
      model: 'opus',
      acpAgentId: 'claude',
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects ACP fields disguised as an LLM provider request', () => {
    const parsed = ChatRequestSchema.safeParse({
      target: { type: 'browseros', providerId: 'provider-1' },
      conversationId: crypto.randomUUID(),
      message: 'hello',
      provider: 'claude-code',
      providerId: 'provider-1',
      model: 'opus',
      acpAgentId: 'claude',
    })

    expect(parsed.success).toBe(false)
  })
})
