import { useEffect } from 'react'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

/** Activates the remote connector service only from an integrations surface. */
export function useActivateRemoteIntegrations(enabled: boolean): void {
  const { baseUrl } = useAgentServerUrl()

  useEffect(() => {
    if (!enabled || !baseUrl) return
    const controller = new AbortController()
    void fetch(`${baseUrl}/klavis/activate`, {
      method: 'POST',
      signal: controller.signal,
    }).catch(() => {
      // Connector availability is shown by the integrations screen; ordinary
      // browsing and chat do not depend on the optional remote service.
    })
    return () => controller.abort()
  }, [baseUrl, enabled])
}
