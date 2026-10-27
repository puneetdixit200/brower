import { type FC, useCallback, useEffect, useState } from 'react'
import { getAgentServerUrl, getMcpServerUrl } from '@/lib/browseros/helpers'
import { BrowserClawMcpBanner } from './BrowserClawMcpBanner'
import { IntegrationsSection } from './IntegrationsSection'
import { MCPServerHeader } from './MCPServerHeader'
import { MCPToolsSection } from './MCPToolsSection'

/** @public */
export const MCPSettingsPage: FC = () => {
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [urlLoading, setUrlLoading] = useState(true)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)

  const loadServerUrl = useCallback(async () => {
    setUrlLoading(true)
    setUrlError(null)
    try {
      const [mcpUrl, agentUrl] = await Promise.all([
        getMcpServerUrl(),
        getAgentServerUrl(),
      ])
      setServerUrl(mcpUrl)
      const response = await fetch(`${agentUrl}/mcp-manager/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok)
        throw new Error(
          `Failed to load MCP access credentials: ${response.status}`,
        )
      const body = (await response.json()) as { token: string }
      setAccessToken(body.token)
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setUrlLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServerUrl()
  }, [loadServerUrl])

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <MCPServerHeader
        serverUrl={serverUrl}
        isLoading={urlLoading}
        error={urlError}
        accessToken={accessToken}
        onServerRestart={loadServerUrl}
      />

      <BrowserClawMcpBanner />

      <IntegrationsSection serverUrl={serverUrl} accessToken={accessToken} />

      <MCPToolsSection />
    </div>
  )
}
