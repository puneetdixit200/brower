import { describe, expect, it, mock } from 'bun:test'
import { type ComponentProps, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

type MockButtonProps = ComponentProps<'button'> & {
  variant?: string
  size?: string
}

mock.module('@/components/ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: MockButtonProps) =>
    createElement('button', { type: 'button', ...props }, children),
}))

const { ScheduledTasksUnavailableNotice } = await import(
  './ScheduledTasksUnavailableNotice'
)

function render(retrying: boolean) {
  const onRetry = () => {}
  return renderToStaticMarkup(
    createElement(ScheduledTasksUnavailableNotice, {
      onRetry,
      retrying,
    }),
  )
}

describe('ScheduledTasksUnavailableNotice', () => {
  it('distinguishes an unavailable schedule API from an empty schedule list', () => {
    const html = render(false)

    expect(html).toContain('role="alert"')
    expect(html).toContain(
      'Couldn’t load scheduled tasks or their run history.',
    )
    expect(html).toContain('Your saved tasks have not been changed.')
    expect(html).toContain('>Retry</button>')
  })

  it('prevents duplicate retries while both schedule queries refresh', () => {
    const html = render(true)

    expect(html).toContain('disabled=""')
    expect(html).toContain('>Retrying…</button>')
  })
})
