import { Check, History, Plus, Search } from 'lucide-react'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  canSearchBrowserHistory,
  type SelectedHistoryContext,
} from './history-context'

interface HistoryResult extends SelectedHistoryContext {
  title: string
  url: string
  lastVisitTime?: number
  visitCount?: number
}

export const HistoryPickerPopover: FC<{
  selected: SelectedHistoryContext[]
  onAdd: (entry: SelectedHistoryContext) => void
}> = ({ selected, onAdd }) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HistoryResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const incognito = !canSearchBrowserHistory(
    chrome.extension.inIncognitoContext,
  )

  const search = async () => {
    if (!query.trim() || incognito) return
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const entries = await chrome.history.search({
        text: query.trim().slice(0, 200),
        startTime: 0,
        maxResults: 8,
      })
      setResults(
        entries.flatMap((entry) =>
          entry.id && entry.url && /^https?:/i.test(entry.url)
            ? [
                {
                  id: entry.id,
                  title: entry.title || entry.url,
                  url: entry.url,
                  lastVisitTime: entry.lastVisitTime,
                  visitCount: entry.visitCount,
                },
              ]
            : [],
        ),
      )
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'History search failed',
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
          aria-label="Attach browser history"
          title={
            incognito
              ? 'History is unavailable in incognito'
              : 'Attach browser history'
          }
          disabled={incognito}
          className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] transition-colors ${selected.length ? 'bg-[var(--accent-orange)] text-white' : 'text-muted-foreground hover:bg-accent hover:text-foreground'} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <History className="size-3" />
          <span>History</span>
          <span className="font-mono text-[10.5px]">{selected.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(24rem,calc(100vw-24px))] space-y-3 p-3"
      >
        <div>
          <h3 className="font-medium text-sm">Attach browser history</h3>
          <p className="text-muted-foreground text-xs">
            Search local history. Only selected titles and site names join this
            request.
          </p>
        </div>
        {incognito ? (
          <p className="rounded-md border border-dashed p-3 text-center text-muted-foreground text-xs">
            History is unavailable in incognito mode.
          </p>
        ) : (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void search()
              }}
            >
              <input
                className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-2 text-sm"
                aria-label="Search browser history"
                placeholder="Search visited pages"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <Button
                size="icon"
                type="submit"
                variant="outline"
                aria-label="Search history"
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
              {results.map((entry) => {
                const isSelected = selected.some((item) => item.id === entry.id)
                let site = entry.url
                try {
                  site = new URL(entry.url).host
                } catch {
                  /* filtered above */
                }
                return (
                  <div key={entry.id} className="rounded-md border p-2.5">
                    <p className="line-clamp-2 font-medium text-xs">
                      {entry.title}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {site}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant={isSelected ? 'secondary' : 'ghost'}
                      className="mt-1 h-7 px-2 text-xs"
                      disabled={isSelected || selected.length >= 3}
                      onClick={() => onAdd(entry)}
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
                  No matching history entries.
                </p>
              )}
              {!loading && !searched && (
                <p className="p-2 text-center text-muted-foreground text-xs">
                  Search your browser history.
                </p>
              )}
              {loading && (
                <p className="p-2 text-center text-muted-foreground text-xs">
                  Searching…
                </p>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
