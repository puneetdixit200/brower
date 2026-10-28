import { describe, expect, it } from 'bun:test'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { buildAgentFilesystemToolSet } from '../../src/agent/ai-sdk-agent'
import type { ResolvedAgentConfig } from '../../src/agent/types'

function agentConfig(
  overrides: Partial<ResolvedAgentConfig> = {},
): ResolvedAgentConfig {
  return {
    conversationId: crypto.randomUUID(),
    provider: LLM_PROVIDERS.OPENAI,
    model: 'test-model',
    ...overrides,
  }
}

describe('buildAgentFilesystemToolSet', () => {
  it('includes only generated-output read access when no workspace is selected', () => {
    const tools = buildAgentFilesystemToolSet(agentConfig())
    expect(Object.keys(tools)).toEqual(['filesystem_read'])
  })

  it('includes filesystem tools when a workspace is selected', () => {
    const tools = buildAgentFilesystemToolSet(
      agentConfig({ workingDir: '/tmp/browseros-workspace' }),
    )
    expect(Object.keys(tools).sort()).toEqual([
      'filesystem_bash',
      'filesystem_edit',
      'filesystem_find',
      'filesystem_grep',
      'filesystem_ls',
      'filesystem_read',
      'filesystem_write',
    ])
  })

  it('passes configured resources to filesystem_bash for packaged runtime lookup', async () => {
    if (process.platform !== 'linux') return
    const tools = buildAgentFilesystemToolSet(
      agentConfig({ workingDir: process.cwd() }),
      { resourcesDir: '/missing-browseros-resources' },
    )
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    const result = await (tools.filesystem_bash as any).execute({
      command: 'bun --version',
    })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('bundled Bun runtime')
  })

  it('exposes only output-file reads in chat mode even when a workspace is selected', () => {
    const tools = buildAgentFilesystemToolSet(
      agentConfig({ chatMode: true, workingDir: '/tmp/browseros-workspace' }),
    )
    expect(Object.keys(tools)).toEqual(['filesystem_read'])
  })

  it('allows workspace inspection but excludes mutation and command tools in read-only permission mode', () => {
    const tools = buildAgentFilesystemToolSet(
      agentConfig({
        permissionMode: 'read-only',
        workingDir: '/tmp/browseros-workspace',
      }),
    )

    expect(Object.keys(tools).sort()).toEqual([
      'filesystem_find',
      'filesystem_grep',
      'filesystem_ls',
      'filesystem_read',
    ])
  })
})
