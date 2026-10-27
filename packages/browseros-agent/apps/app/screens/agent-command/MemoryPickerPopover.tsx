import { Brain, Check, Plus, Search } from 'lucide-react'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import type { SelectedMemoryContext } from './memory-context'

interface MemorySearchResult extends SelectedMemoryContext {
  updatedAt: number
}

export const MemoryPickerPopover: FC<{
  selected: SelectedMemoryContext[]
  onAdd: (memory: SelectedMemoryContext) => void
}> = ({ selected, onAdd }) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemorySearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const serverUrl = await getAgentServerUrl()
      const response = await fetch(`${serverUrl}/memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const body = (await response.json()) as {
        memories?: MemorySearchResult[]
        error?: string
      }
      if (!response.ok)
        throw new Error(body.error ?? `Search failed (${response.status})`)
      setResults(body.memories ?? [])
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Memory search failed',
      )
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Attach saved memory"
          title="Attach saved memory"
          className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] transition-colors ${selected.length ? 'bg-[var(--accent-orange)] text-white' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
        >
          <Brain className="size-3" />
          <span>Memory</span>
          <span className="font-mono text-[10.5px]">{selected.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(24rem,calc(100vw-24px))] space-y-3 p-3"
      >
        <div>
          <h3 className="font-medium text-sm">Attach saved memory</h3>
          <p className="text-muted-foreground text-xs">
            Only selected notes join this request and go to its selected AI
            provider.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-2 text-sm"
            aria-label="Search saved memory"
            placeholder="Search notes"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Button
            size="icon"
            type="submit"
            variant="outline"
            aria-label="Search memory"
            disabled={loading || !query.trim()}
          >
            <Search className="size-4" />
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
        <div className="max-h-56 space-y-2 overflow-y-auto">
          {results.map((memory) => {
            const isSelected = selected.some((item) => item.id === memory.id)
            return (
              <div key={memory.id} className="rounded-md border p-2.5">
                <p className="line-clamp-3 whitespace-pre-wrap text-xs">
                  {memory.content}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant={isSelected ? 'secondary' : 'ghost'}
                  className="mt-1 h-7 px-2 text-xs"
                  disabled={isSelected || (selected.length >= 3 && !isSelected)}
                  onClick={() => onAdd(memory)}
                >
                  {isSelected ? (
                    <Check className="mr-1 size-3" />
                  ) : (
                    <Plus className="mr-1 size-3" />
                  )}
                  {isSelected ? 'Added' : 'Add to request'}
                </Button>
              </div>
            )
          })}
          {!loading && results.length === 0 && searched && (
            <p className="rounded-md border border-dashed p-3 text-center text-muted-foreground text-xs">
              No matches. Memory retrieval must be enabled in Settings → Memory.
            </p>
          )}
          {!loading && !searched && (
            <p className="p-2 text-center text-muted-foreground text-xs">
              Search your saved notes.
            </p>
          )}
          {loading && (
            <p className="p-2 text-center text-muted-foreground text-xs">
              Searching…
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
