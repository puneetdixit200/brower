import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement, type FC, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TabPickerPopoverProps } from './tab-picker-popover'

let selectedTabs: chrome.tabs.Tab[] = []
let allTabs: chrome.tabs.Tab[] = []
let loadingTabs = false
let renderedAttachAction: (() => void) | undefined

mock.module('@/components/ui/command', () => ({
  Command: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  CommandEmpty: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  CommandGroup: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  CommandInput: () => null,
  CommandItem: ({
    children,
    disabled,
    onSelect,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onSelect?: () => void
    'aria-label'?: string
  }) => {
    if (onSelect) renderedAttachAction = onSelect
    return createElement(
      'div',
      {
        role: 'option',
        'aria-disabled': disabled ? 'true' : undefined,
        'aria-label': ariaLabel,
      },
      children,
    )
  },
  CommandList: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
}))

mock.module('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  PopoverAnchor: () => null,
  PopoverContent: ({
    children,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    'aria-label'?: string
  }) => createElement('div', { 'aria-label': ariaLabel }, children),
  PopoverTrigger: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
}))

mock.module('./available-tabs.hooks', () => ({
  useAvailableTabs: () => ({
    tabs: selectedTabs,
    allTabs,
    isLoading: loadingTabs,
  }),
}))

mock.module('./tab-list-item', () => ({
  TabListItem: () => createElement('span', null, 'Tab'),
}))

let TabPickerPopover: FC<TabPickerPopoverProps>

beforeAll(async () => {
  TabPickerPopover = (await import('./tab-picker-popover')).TabPickerPopover
})

beforeEach(() => {
  selectedTabs = []
  allTabs = []
  loadingTabs = false
  renderedAttachAction = undefined
})

function renderMention(
  onAttachFile?: () => void,
  attachFileDisabled = false,
): string {
  return renderToStaticMarkup(
    createElement(TabPickerPopover, {
      variant: 'mention',
      isOpen: true,
      filterText: '',
      selectedTabs: [],
      onToggleTab: () => {},
      onClose: () => {},
      anchorRef: { current: null },
      onAttachFile,
      attachFileDisabled,
    }),
  )
}

describe('TabPickerPopover mention file action', () => {
  it('exposes an accessible attach choice only when opted in and activates the callback', () => {
    const attachFile = mock(() => {})
    const html = renderMention(attachFile)

    expect(html).toContain('role="option"')
    expect(html).toContain('aria-label="Select tabs or attach files"')
    expect(html).toContain('aria-label="Attach a file"')
    expect(html).toContain('Attach a file…')
    expect(renderedAttachAction).toBeDefined()

    renderedAttachAction?.()

    expect(attachFile).toHaveBeenCalledTimes(1)
  })

  it('does not change other mention picker consumers when no callback is supplied', () => {
    const html = renderMention()

    expect(html).not.toContain('Attach a file…')
    expect(html).toContain('aria-label="Select tabs to attach"')
  })

  it('does not invoke the attach callback when the action is disabled', () => {
    const attachFile = mock(() => {})
    const html = renderMention(attachFile, true)

    expect(html).toContain('aria-disabled="true"')
    renderedAttachAction?.()

    expect(attachFile).not.toHaveBeenCalled()
  })
})
