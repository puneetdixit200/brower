import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

interface Recipe {
  id: string
  title: string
  origin: string
  instructions: string
  stale: boolean
  updatedAt: number
  verifiedAt: number | null
}

export function SiteRecipesPanel({
  enabled,
  incognito,
}: {
  enabled: boolean
  incognito: boolean
}) {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [title, setTitle] = useState('')
  const [origin, setOrigin] = useState('')
  const [instructions, setInstructions] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const request = useCallback(async (route: string, init?: RequestInit) => {
    if (!enabled || incognito) throw new Error('Recipes unavailable here')
    const baseUrl = await getAgentServerUrl()
    const response = await fetch(baseUrl + '/site-recipes' + route, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Aster-Incognito': 'false',
        ...init?.headers,
      },
    })
    const result = await response.json() as {
      recipes?: Recipe[]
      error?: string
    }
    if (!response.ok) throw new Error(result.error || 'Recipe request failed')
    return result
  }, [enabled, incognito])

  const refresh = useCallback(async () => {
    const result = await request('')
    setRecipes(result.recipes ?? [])
  }, [request])

  useEffect(() => {
    if (!enabled || incognito) {
      setRecipes([])
      return
    }
    void refresh().catch(() => setError('Could not load saved site recipes'))
  }, [enabled, incognito, refresh])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await request(selected ? '/' + encodeURIComponent(selected) : '', {
        method: selected ? 'PUT' : 'POST',
        body: JSON.stringify({ title, origin, instructions }),
      })
      setSelected(null)
      setTitle('')
      setOrigin('')
      setInstructions('')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save recipe')
    } finally {
      setSaving(false)
    }
  }

  const verify = async (recipe: Recipe) => {
    if (!window.confirm(
      'Confirm you have manually checked this recipe on ' + recipe.origin +
      '? This does not execute or validate website steps automatically.',
    )) return
    setSaving(true)
    try {
      await request('/' + recipe.id + '/verify', {
        method: 'POST',
        body: JSON.stringify({ origin: recipe.origin }),
      })
      await refresh()
    } catch {
      setError('Recipe could not be marked verified')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (recipe: Recipe) => {
    if (!window.confirm('Delete this site recipe?')) return
    setSaving(true)
    try {
      await request('/' + recipe.id, { method: 'DELETE' })
      if (selected === recipe.id) setSelected(null)
      await refresh()
    } catch {
      setError('Unable to delete recipe')
    } finally {
      setSaving(false)
    }
  }

  if (!enabled || incognito) return null
  return (
    <section aria-label="Saved site recipes" className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold">Site recipes</h2>
        <p className="mt-1 text-muted-foreground text-xs">
          Save your own site instructions for a specific HTTPS origin. Recipes
          become stale after 30 days or when edited. They are never executed
          automatically, and must not contain passwords or codes.
        </p>
      </div>
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
      <div className="space-y-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          placeholder="Recipe name"
          aria-label="Site recipe title"
          maxLength={120}
          className="w-full rounded-md border bg-background p-2 text-sm"
        />
        <input
          value={origin}
          onChange={(event) => setOrigin(event.currentTarget.value)}
          placeholder="https://example.org"
          aria-label="Site recipe HTTPS origin"
          className="w-full rounded-md border bg-background p-2 text-sm"
        />
        <Textarea
          value={instructions}
          onChange={(event) => setInstructions(event.currentTarget.value)}
          placeholder="Describe the site steps. Do not include credentials."
          rows={3}
          maxLength={6000}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={saving || !title.trim() || !origin.trim() || !instructions.trim()}
            onClick={() => void save()}
          >
            {selected ? 'Update recipe' : 'Save recipe'}
          </Button>
          {selected && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setSelected(null)
                setTitle('')
                setOrigin('')
                setInstructions('')
              }}
            >
              Cancel edit
            </Button>
          )}
        </div>
      </div>
      <ul className="space-y-2">
        {recipes.map((recipe) => (
          <li key={recipe.id} className="space-y-2 rounded-md border p-3">
            <p className="font-medium text-sm">{recipe.title}</p>
            <p className="break-all text-muted-foreground text-xs">{recipe.origin}</p>
            <p className="text-xs">{recipe.stale ? 'Needs manual revalidation' : 'User-verified within 30 days'}</p>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" type="button" variant="outline" onClick={() => {
                setSelected(recipe.id)
                setTitle(recipe.title)
                setOrigin(recipe.origin)
                setInstructions(recipe.instructions)
              }}>Edit</Button>
              <Button size="sm" type="button" variant="outline" disabled={saving} onClick={() => void verify(recipe)}>Mark manually checked</Button>
              <Button size="sm" type="button" variant="outline" disabled={saving} onClick={() => void remove(recipe)}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
