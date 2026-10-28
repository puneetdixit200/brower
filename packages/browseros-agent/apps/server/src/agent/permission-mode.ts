export type PermissionMode = 'guard' | 'read-only' | 'full'

/** Resolve legacy task mode before applying the new explicit permission choice. */
export function resolvePermissionMode(
  taskMode: 'chat' | 'agent' | undefined,
  requested: PermissionMode | undefined,
): Exclude<PermissionMode, 'full'> {
  if (requested === 'full') {
    throw new Error('Full access is not available.')
  }
  if (taskMode === 'chat' || requested === 'read-only') return 'read-only'
  return 'guard'
}

export function permissionModeTargetError(
  target: 'browseros' | 'acp',
  mode: Exclude<PermissionMode, 'full'>,
): string | undefined {
  if (target === 'acp' && mode === 'read-only') {
    return 'Read-only permission mode is unavailable for ACP agents because their workspace tools cannot be restricted by the server.'
  }
  return undefined
}
