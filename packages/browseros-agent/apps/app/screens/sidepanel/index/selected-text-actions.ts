export type SelectedTextAction = 'summarize' | 'translate'

export function getSelectedTextActionPrompt(
  action: SelectedTextAction,
): string {
  if (action === 'summarize') {
    return 'Summarize the selected text in three concise bullet points.'
  }
  return 'Translate the selected text. If I have not specified a target language, ask me which language to use.'
}
