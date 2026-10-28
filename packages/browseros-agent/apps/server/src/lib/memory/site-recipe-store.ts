import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDbHandle } from '../db'

export interface SiteRecipe {
  id: string
  origin: string
  title: string
  instructions: string
  updatedAt: number
  verifiedAt: number | null
}

const MAX_RECIPES = 150
const STALE_AFTER_MS = 30 * 86_400_000
const CREDENTIAL_ASSIGNMENT =
  /(?:password|passphrase|api[_ -]?key|secret|access[_ -]?token|bearer|otp|totp)\\s*[:=]\\s*\\S+/i

/** Recipes are instructions, never a password vault or model prompt cache. */
function assertNonsecretInstructions(value: string): void {
  if (CREDENTIAL_ASSIGNMENT.test(value)) {
    throw new Error('Site recipes may not contain credential assignments')
  }
}

export function siteRecipeOrigin(input: string): string {
  const parsed = new URL(input)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Recipes require an HTTPS origin without credentials')
  }
  if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) {
    throw new Error('Local service recipes are not supported')
  }
  return parsed.origin
}

function filePath(): string {
  return join(dirname(getDbHandle().path), 'memory', 'site-recipes.json')
}

function read(): SiteRecipe[] {
  const path = filePath()
  if (!existsSync(path)) return []
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error('Refusing a symlinked recipe store')
  }
  const bytes = readFileSync(path)
  if (bytes.length > 1_000_000) throw new Error('Recipe store exceeds size limit')
  const parsed: unknown = JSON.parse(bytes.toString('utf8'))
  if (!Array.isArray(parsed)) throw new Error('Invalid recipe store')
  return parsed.slice(0, MAX_RECIPES) as SiteRecipe[]
}

function write(data: SiteRecipe[]): void {
  const path = filePath()
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error('Refusing a symlinked recipe store')
  }
  const temp = join(directory, '.site-recipes-' + randomUUID() + '.tmp')
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  renameSync(temp, path)
}

export const siteRecipeStore = {
  list(): (SiteRecipe & { stale: boolean })[] {
    return read().map((item) => ({
      ...item,
      stale: item.verifiedAt === null || Date.now() - item.verifiedAt > STALE_AFTER_MS,
    }))
  },
  save(input: { id?: string; origin: string; title: string; instructions: string }): SiteRecipe {
    assertNonsecretInstructions(input.instructions)
    const entries = read()
    const origin = siteRecipeOrigin(input.origin)
    const existing = input.id ? entries.find((item) => item.id === input.id) : undefined
    if (input.id && !existing) throw new Error('Recipe not found')
    if (!existing && entries.length >= MAX_RECIPES) throw new Error('Recipe limit reached')
    const now = Date.now()
    const entry: SiteRecipe = {
      id: existing?.id ?? randomUUID(),
      origin,
      title: input.title.trim(),
      instructions: input.instructions.trim(),
      updatedAt: now,
      verifiedAt: null, // Any edit makes a recipe stale until user validates it.
    }
    const next = entries.filter((item) => item.id !== entry.id)
    next.unshift(entry)
    write(next)
    return entry
  },
  verify(id: string, expectedOrigin: string): SiteRecipe {
    const entries = read()
    const item = entries.find((entry) => entry.id === id)
    if (!item || item.origin !== siteRecipeOrigin(expectedOrigin)) {
      throw new Error('Recipe ID or origin does not match')
    }
    item.verifiedAt = Date.now()
    write(entries)
    return item
  },
  delete(id: string): boolean {
    const entries = read()
    if (!entries.some((entry) => entry.id === id)) return false
    write(entries.filter((entry) => entry.id !== id))
    return true
  },
}
