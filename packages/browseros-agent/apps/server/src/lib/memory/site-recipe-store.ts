import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
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
const MAX_TITLE_LENGTH = 120
const MAX_INSTRUCTIONS_LENGTH = 6000
const MAX_FUTURE_SKEW_MS = 5 * 60_000
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CREDENTIAL_ASSIGNMENT =
  /(?:password|passwd|passphrase|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token|auth(?:orization)?|cookie|bearer|otp|totp)\s*[:=]\s*\S+/i

/** Recipes are instructions, never a password vault or model prompt cache. */
function assertNonsecretInstructions(value: string): void {
  if (CREDENTIAL_ASSIGNMENT.test(value)) {
    throw new Error('Site recipes may not contain credential assignments')
  }
}

function assertRecipeText(
  title: unknown,
  instructions: unknown,
): asserts title is string {
  if (typeof title !== 'string' || typeof instructions !== 'string') {
    throw new Error('Recipe title and instructions must be text')
  }
  const cleanTitle = title.trim()
  const cleanInstructions = instructions.trim()
  if (!cleanTitle || cleanTitle.length > MAX_TITLE_LENGTH) {
    throw new Error(`Recipe title must be 1-${MAX_TITLE_LENGTH} characters`)
  }
  if (
    !cleanInstructions ||
    cleanInstructions.length > MAX_INSTRUCTIONS_LENGTH
  ) {
    throw new Error(
      `Recipe instructions must be 1-${MAX_INSTRUCTIONS_LENGTH} characters`,
    )
  }
  assertNonsecretInstructions(cleanTitle)
  assertNonsecretInstructions(cleanInstructions)
}

export function siteRecipeOrigin(input: string): string {
  if (typeof input !== 'string') throw new Error('Invalid recipe origin')
  const parsed = new URL(input)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Recipes require an HTTPS origin without credentials')
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Recipes require a bare HTTPS origin')
  }
  if (parsed.hostname.endsWith('..')) {
    throw new Error('Recipes require a valid public hostname')
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  const blockedSuffixes = [
    'localhost',
    'local',
    'internal',
    'test',
    'invalid',
    'example',
    'onion',
  ]
  if (
    !hostname.includes('.') ||
    hostname.length > 253 ||
    hostname
      .split('.')
      .some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
      ) ||
    blockedSuffixes.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    )
  ) {
    throw new Error('Recipes require a public HTTPS hostname')
  }
  // IP literals are excluded so a recipe cannot be bound directly to a private service.
  if (
    hostname.startsWith('[') ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    /^0x[\da-f]+$/i.test(hostname)
  ) {
    throw new Error('Recipes require a public HTTPS hostname')
  }
  return `https://${hostname}${parsed.port ? `:${parsed.port}` : ''}`
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
  if (bytes.length > 1_000_000)
    throw new Error('Recipe store exceeds size limit')
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Invalid recipe store JSON')
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_RECIPES)
    throw new Error('Invalid recipe store')
  const now = Date.now()
  const ids = new Set<string>()
  let previousUpdatedAt = Number.POSITIVE_INFINITY
  const recipes: SiteRecipe[] = []
  for (const value of parsed) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('Invalid recipe record')
    const item = value as Record<string, unknown>
    if (
      Object.keys(item).sort().join(',') !==
      'id,instructions,origin,title,updatedAt,verifiedAt'
    ) {
      throw new Error('Invalid recipe record shape')
    }
    if (typeof item.id !== 'string' || !UUID_PATTERN.test(item.id)) {
      throw new Error('Invalid recipe ID')
    }
    const normalizedId = item.id.toLowerCase()
    if (ids.has(normalizedId)) throw new Error('Duplicate recipe ID')
    ids.add(normalizedId)
    if (
      typeof item.origin !== 'string' ||
      siteRecipeOrigin(item.origin) !== item.origin
    )
      throw new Error('Invalid recipe origin')
    assertRecipeText(item.title, item.instructions)
    if (
      !Number.isSafeInteger(item.updatedAt) ||
      (item.updatedAt as number) < 0 ||
      (item.updatedAt as number) > now + MAX_FUTURE_SKEW_MS
    ) {
      throw new Error('Invalid recipe timestamp')
    }
    if ((item.updatedAt as number) > previousUpdatedAt)
      throw new Error('Recipe records are out of order')
    previousUpdatedAt = item.updatedAt as number
    if (
      item.verifiedAt !== null &&
      (!Number.isSafeInteger(item.verifiedAt) ||
        (item.verifiedAt as number) < (item.updatedAt as number) ||
        (item.verifiedAt as number) > now + MAX_FUTURE_SKEW_MS)
    ) {
      throw new Error('Invalid recipe verification timestamp')
    }
    recipes.push({
      id: item.id,
      origin: item.origin,
      title: (item.title as string).trim(),
      instructions: (item.instructions as string).trim(),
      updatedAt: item.updatedAt as number,
      verifiedAt: item.verifiedAt as number | null,
    })
  }
  return recipes
}

function write(data: SiteRecipe[]): void {
  const path = filePath()
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error('Refusing a symlinked recipe store')
  }
  const temp = join(directory, `.site-recipes-${randomUUID()}.tmp`)
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  })
  renameSync(temp, path)
}

export const siteRecipeStore = {
  list(): (SiteRecipe & { stale: boolean })[] {
    return read().map((item) => ({
      ...item,
      stale:
        item.verifiedAt === null ||
        Date.now() - item.verifiedAt > STALE_AFTER_MS,
    }))
  },
  save(input: {
    id?: string
    origin: string
    title: string
    instructions: string
  }): SiteRecipe {
    if (!input || typeof input !== 'object') throw new Error('Invalid recipe')
    assertRecipeText(input.title, input.instructions)
    if (
      input.id !== undefined &&
      (typeof input.id !== 'string' || !UUID_PATTERN.test(input.id))
    ) {
      throw new Error('Invalid recipe ID')
    }
    const entries = read()
    const origin = siteRecipeOrigin(input.origin)
    const existing = input.id
      ? entries.find((item) => item.id === input.id)
      : undefined
    if (input.id && !existing) throw new Error('Recipe not found')
    if (!existing && entries.length >= MAX_RECIPES)
      throw new Error('Recipe limit reached')
    const now = Math.max(Date.now(), ...entries.map((item) => item.updatedAt))
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
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      throw new Error('Invalid recipe ID')
    }
    const entries = read()
    const item = entries.find((entry) => entry.id === id)
    if (!item || item.origin !== siteRecipeOrigin(expectedOrigin)) {
      throw new Error('Recipe ID or origin does not match')
    }
    item.verifiedAt = Math.max(Date.now(), item.updatedAt, item.verifiedAt ?? 0)
    write(entries)
    return item
  },
  delete(id: string): boolean {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      throw new Error('Invalid recipe ID')
    }
    const entries = read()
    if (!entries.some((entry) => entry.id === id)) return false
    write(entries.filter((entry) => entry.id !== id))
    return true
  },
}
