/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { BROWSER_TOOLS } from '@browseros/browser-mcp/registry'
import type { ToolDefinition } from '@browseros/browser-mcp/tools/framework'
import { INLINED_ENV } from '../../../env'

const ASTER_BLOCKED_RAW_TOOLS = new Set(['run', 'evaluate'])

/**
 * Returns the product-specific browser MCP catalog for agent and external clients.
 * Aster does not expose raw page-code/CDP execution tools to MCP clients.
 */
export function getProductBrowserMcpTools(
  tools: readonly ToolDefinition[] = BROWSER_TOOLS,
  productBuild: string | undefined = INLINED_ENV.ASTER_SERVER_BUILD,
): readonly ToolDefinition[] {
  if (productBuild !== 'aster') return tools
  return tools.filter((tool) => !ASTER_BLOCKED_RAW_TOOLS.has(tool.name))
}
