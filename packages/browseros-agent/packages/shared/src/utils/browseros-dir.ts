import { homedir } from 'node:os'
import { join } from 'node:path'
import { PATHS } from '../constants/paths'

const ASTER_DIR_NAME = '.aster'
const DEV_ASTER_DIR_NAME = '.aster-dev'

/** Resolves the local state root for the product baked into this server build. */
export function getProductStateDir(
  asterServerBuild: string | undefined = process.env.ASTER_SERVER_BUILD,
): string {
  if (asterServerBuild === 'aster') {
    const asterOverride = process.env.ASTER_DIR?.trim()
    if (asterOverride) return asterOverride

    const asterDirName =
      process.env.NODE_ENV === 'development'
        ? DEV_ASTER_DIR_NAME
        : ASTER_DIR_NAME
    return join(homedir(), asterDirName)
  }

  const browserosOverride = process.env.BROWSEROS_DIR?.trim()
  if (browserosOverride) return browserosOverride

  const browserosDirName =
    process.env.NODE_ENV === 'development'
      ? PATHS.DEV_BROWSEROS_DIR_NAME
      : PATHS.BROWSEROS_DIR_NAME
  return join(homedir(), browserosDirName)
}
