import { describe, expect, it } from 'bun:test'
import { formatApprovalInput } from './approval-preview'

describe('agent approval details', () => {
  it('redacts nested credential keys and bearer values', () => {
    const preview = formatApprovalInput({
      action: 'post',
      payload: {
        password: 'password-not-for-ui',
        ordinaryText: 'Bearer abcdefghijklmnopqrstuvwxyz123',
        destination: 'https://example.org/api?secret=should-not-leak',
      },
    })
    expect(preview).toContain('post')
    expect(preview).not.toContain('password-not-for-ui')
    expect(preview).not.toContain('abcdefghijklmnopqrstuvwxyz123')
    expect(preview).not.toContain('should-not-leak')
    expect(preview).toContain('example.org')
  })

  it('rejects embedded credentials in a destination URL', () => {
    expect(formatApprovalInput({ url: 'https://user:password@example.org/' }))
      .not.toContain('password@example')
  })

  it('bounds nested, circular and large model input', () => {
    const obj: { cyclic?: unknown; list: string[] } = { list: Array(1000).fill('x'.repeat(200)) }
    obj.cyclic = obj
    const preview = formatApprovalInput(obj)
    expect(preview.length).toBeLessThan(6500)
    expect(preview).toContain('[additional items omitted]')
    expect(preview).toContain('[circular reference]')
  })
})
