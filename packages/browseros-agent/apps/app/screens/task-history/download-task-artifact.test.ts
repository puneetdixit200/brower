import { describe, expect, it } from 'bun:test'
import { fetchTaskArtifact } from './download-task-artifact'

describe('fetchTaskArtifact', () => {
  it('requests only the conversation-scoped opaque artifact endpoint', async () => {
    let requestedUrl = ''
    const blob = new Blob(['artifact'])
    const result = await fetchTaskArtifact({
      serverUrl: 'http://127.0.0.1:9000',
      conversationId: 'conversation/with spaces',
      artifactId: 'opaque capability',
      fetcher: async (input) => {
        requestedUrl = String(input)
        return new Response(blob)
      },
    })
    expect(requestedUrl).toBe(
      'http://127.0.0.1:9000/chat/conversation%2Fwith%20spaces/artifacts/opaque%20capability',
    )
    expect(await result.text()).toBe('artifact')
  })

  it('rejects missing or unauthorized artifacts', async () => {
    await expect(
      fetchTaskArtifact({
        serverUrl: 'http://127.0.0.1:9000',
        conversationId: 'conversation',
        artifactId: 'opaque',
        fetcher: async () => new Response(null, { status: 404 }),
      }),
    ).rejects.toThrow('Task artifact is unavailable.')
  })
})
