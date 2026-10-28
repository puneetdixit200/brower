import { describe, expect, it } from 'bun:test'
import type { ToolDefinition } from '@browseros/browser-mcp/tools/framework'
import { getProductBrowserMcpTools } from '../../../../src/api/services/mcp/browser-mcp-catalog'

const tools = [
  { name: 'run' },
  { name: 'evaluate' },
  { name: 'navigate' },
] as ToolDefinition[]

describe('product browser MCP catalog', () => {
  it('removes raw page-code tools from Aster builds', () => {
    expect(
      getProductBrowserMcpTools(tools, 'aster').map((tool) => tool.name),
    ).toEqual(['navigate'])
  })

  it('preserves the BrowserOS catalog for other builds', () => {
    expect(
      getProductBrowserMcpTools(tools, 'browseros').map((tool) => tool.name),
    ).toEqual(['run', 'evaluate', 'navigate'])
    expect(getProductBrowserMcpTools(tools, undefined)).toBe(tools)
  })
})
