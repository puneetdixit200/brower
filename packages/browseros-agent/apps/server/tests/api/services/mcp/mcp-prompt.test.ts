import { describe, expect, it } from 'bun:test'
import {
  getProductMcpInstructions,
  MCP_INSTRUCTIONS,
} from '../../../../src/api/services/mcp/mcp-prompt'

describe('product MCP instructions', () => {
  it('aligns Aster instructions with its restricted browser and credential tools', () => {
    const instructions = getProductMcpInstructions('aster')

    expect(instructions).toContain('Aster Browser MCP Server')
    expect(instructions).toContain(
      'Raw page-code and CDP execution tools are unavailable.',
    )
    expect(instructions).toContain(
      'Never ask the agent to read, export, or fill saved credentials.',
    )
    expect(instructions).not.toContain('run for page-context JavaScript')
    expect(instructions).not.toContain('proceed if credentials provided')
  })

  it('preserves BrowserOS instructions for other product builds', () => {
    expect(getProductMcpInstructions('browseros')).toBe(MCP_INSTRUCTIONS)
    expect(getProductMcpInstructions(undefined)).toBe(MCP_INSTRUCTIONS)
  })
})
