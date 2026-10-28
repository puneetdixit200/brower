import { describe, expect, it } from 'bun:test'
import {
  permissionModeTargetError,
  resolvePermissionMode,
} from '../../src/agent/permission-mode'

describe('resolvePermissionMode', () => {
  it('keeps legacy chat mode read-only even when Guard is explicitly requested', () => {
    expect(resolvePermissionMode('chat', 'guard')).toBe('read-only')
  })

  it('defaults legacy agent mode to Guard', () => {
    expect(resolvePermissionMode('agent', undefined)).toBe('guard')
  })

  it('honors explicit Read-only for agent tasks', () => {
    expect(resolvePermissionMode('agent', 'read-only')).toBe('read-only')
  })

  it('fails closed for unsupported Full access', () => {
    expect(() => resolvePermissionMode('agent', 'full')).toThrow(
      'Full access is not available.',
    )
  })

  it('rejects Read-only for ACP because the server cannot restrict its workspace tools', () => {
    expect(permissionModeTargetError('acp', 'read-only')).toContain(
      'cannot be restricted by the server',
    )
    expect(permissionModeTargetError('browseros', 'read-only')).toBeUndefined()
    expect(permissionModeTargetError('acp', 'guard')).toBeUndefined()
  })
})
