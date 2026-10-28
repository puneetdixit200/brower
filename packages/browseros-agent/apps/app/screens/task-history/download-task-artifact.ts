export async function fetchTaskArtifact(args: {
  serverUrl: string
  conversationId: string
  artifactId: string
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}): Promise<Blob> {
  const response = await (args.fetcher ?? fetch)(
    `${args.serverUrl}/chat/${encodeURIComponent(args.conversationId)}/artifacts/${encodeURIComponent(args.artifactId)}`,
  )
  if (!response.ok) throw new Error('Task artifact is unavailable.')
  return await response.blob()
}
