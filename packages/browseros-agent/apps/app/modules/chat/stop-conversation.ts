export async function stopConversationView({
  serverUrl,
  conversationId,
  fetchImpl = fetch,
  detachView,
}: {
  serverUrl: string
  conversationId: string
  fetchImpl?: typeof fetch
  detachView: () => Promise<void>
}) {
  const response = await fetchImpl(
    `${serverUrl}/chat/${encodeURIComponent(conversationId)}/stop`,
    { method: 'POST' },
  )
  if (!response.ok) {
    throw new Error(`Conversation stop failed (${response.status})`)
  }
  // A 200 response with `stopped: false` means there was no active server run;
  // either way, detaching after this response cannot hide a running task.
  await detachView()
}
