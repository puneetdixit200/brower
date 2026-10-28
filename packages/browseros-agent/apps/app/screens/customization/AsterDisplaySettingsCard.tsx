import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useTheme } from '@/components/theme-provider'
import {
  DEFAULT_ASTER_DISPLAY_SETTINGS,
  type AsterDisplayScale,
  type AsterDisplaySettings,
  readAsterDisplaySettings,
  saveAsterDisplaySettings,
} from '@/lib/display/aster-display-settings'
import type { Theme } from '@/lib/theme/theme-storage'

export function AsterDisplaySettingsCard() {
  const { theme, setTheme } = useTheme()
  const [settings, setSettings] = useState<AsterDisplaySettings>(
    DEFAULT_ASTER_DISPLAY_SETTINGS,
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void readAsterDisplaySettings().then((saved) => {
      if (active) {
        setSettings(saved)
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const update = async (patch: Partial<AsterDisplaySettings>) => {
    if (saving || loading) return
    setSaving(true)
    const next = { ...settings, ...patch }
    try {
      await saveAsterDisplaySettings(next)
      setSettings(next)
    } catch {
      toast.error('Could not save Aster display settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h3 className="font-semibold text-lg">Aster Display</h3>
        <p className="mt-1 text-muted-foreground text-xs">
          These settings affect the Aster interface, not the websites you visit.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="aster-theme" className="font-medium text-sm">
            Theme
          </Label>
          <p className="text-muted-foreground text-xs">
            Follow the system, or choose a light or dark interface.
          </p>
        </div>
        <Select
          value={theme ?? 'system'}
          onValueChange={(value) => setTheme(value as Theme)}
        >
          <SelectTrigger id="aster-theme" className="w-36" aria-label="Aster theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <div>
          <Label htmlFor="aster-scale" className="font-medium text-sm">
            Interface scale
          </Label>
          <p className="text-muted-foreground text-xs">
            Adjust text and rem-based interface elements.
          </p>
        </div>
        <Select
          value={String(settings.scale)}
          onValueChange={(value) =>
            void update({ scale: Number(value) as AsterDisplayScale })
          }
          disabled={loading || saving}
        >
          <SelectTrigger id="aster-scale" className="w-36" aria-label="Aster interface scale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="90">90%</SelectItem>
            <SelectItem value="100">100%</SelectItem>
            <SelectItem value="110">110%</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <div>
          <Label htmlFor="aster-reduced-motion" className="font-medium text-sm">
            Reduce interface motion
          </Label>
          <p className="max-w-sm text-muted-foreground text-xs">
            Minimize decorative transitions and animations in Aster. Does not
            change website animations or guarantee battery savings.
          </p>
        </div>
        <Switch
          id="aster-reduced-motion"
          checked={settings.reducedMotion}
          onCheckedChange={(enabled) =>
            void update({ reducedMotion: enabled })
          }
          disabled={loading || saving}
        />
      </div>
    </section>
  )
}
