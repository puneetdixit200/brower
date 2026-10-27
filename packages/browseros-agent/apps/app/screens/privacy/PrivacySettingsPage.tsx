import {
  type FC,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { isIncognitoWindow } from '@/lib/browseros/incognito'
import {
  getPrivacySettingsMessage,
  initialPrivacySettingsState,
  reducePrivacySettingsState,
} from '@/lib/privacy/privacy-settings-state'
import {
  hasEffectiveTelemetryConsent,
  refreshTelemetryConsent,
  setTelemetryConsent,
  subscribeTelemetryConsent,
} from '@/lib/privacy/telemetry-consent'

export const PrivacySettingsPage: FC = () => {
  const [consentState, dispatch] = useReducer(
    reducePrivacySettingsState,
    initialPrivacySettingsState,
  )
  const [identityReady, setIdentityReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [incognito, setIncognito] = useState(false)
  const loadGeneration = useRef(0)
  const loadConsent = useCallback(async () => {
    const request = ++loadGeneration.current
    dispatch({ type: 'load-start', request })
    try {
      const consent = await refreshTelemetryConsent()
      if (request === loadGeneration.current)
        dispatch({
          type: 'load-success',
          request,
          consent,
          appGrantEnabled: hasEffectiveTelemetryConsent(),
        })
    } catch {
      if (request === loadGeneration.current) {
        dispatch({
          type: 'load-failure',
          request,
          message:
            'The local consent service is unavailable. The profile setting could not be confirmed; app error reporting remains off.',
        })
      }
    }
  }, [])
  useEffect(() => {
    let active = true
    void isIncognitoWindow()
      .then((privateWindow) => {
        if (!active) return
        setIncognito(privateWindow)
      })
      .catch(() => {
        // Unknown window identity must fail closed for app error reporting.
        if (active) setIncognito(true)
      })
      .finally(() => {
        if (active) setIdentityReady(true)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    void loadConsent()
  }, [loadConsent])
  useEffect(() => {
    if (!identityReady) return
    return subscribeTelemetryConsent((consent, source = 'snapshot') => {
      dispatch({ type: 'consent-event', consent, source })
      // Storage is only an invalidation hint; the PUT may still fail.
      if (source === 'external-revoke') void loadConsent()
    })
  }, [identityReady, loadConsent])
  const onChange = async (next: boolean) => {
    setBusy(true)
    dispatch({ type: 'mutation-start', enabled: next })
    try {
      const consent = await setTelemetryConsent(next)
      dispatch({ type: 'mutation-success', consent })
    } catch {
      // The operation may have been superseded by a cross-context choice.
      // Re-read canonical state rather than applying this request's stale value.
      await loadConsent()
      dispatch({
        type: 'load-failure',
        request: loadGeneration.current,
        message:
          'Could not save this choice. App error reporting remains off unless the local service confirms it.',
      })
    } finally {
      setBusy(false)
    }
  }
  const scopeMessage = getPrivacySettingsMessage({
    incognito,
    profileEnabled: consentState.profileEnabled,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl">Privacy</h1>
        <p className="mt-2 text-muted-foreground text-sm">
          Choose whether optional Aster app and agent diagnostics may be sent.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Optional app and agent diagnostics</CardTitle>
          <CardDescription>
            Off by default. When enabled, app and agent errors may be sent to
            Sentry after being reduced to content-free technical fields. The
            agent may also send fixed usage counters for startup, chat, MCP, and
            tool requests. Prompts, responses, URLs, account details, provider
            names, tool names, and arbitrary event properties are excluded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium text-sm">
              Allow optional diagnostics
            </span>
            <Switch
              checked={consentState.profileEnabled}
              disabled={
                !consentState.ready || !identityReady || busy || incognito
              }
              onCheckedChange={onChange}
              aria-label="Allow optional app and agent diagnostics"
            />
          </div>
          <p className="text-muted-foreground text-sm">
            This choice controls optional Aster app and agent telemetry. It does
            not control native telemetry in the current BrowserOS development
            binary; the Aster native control awaits a rebuilt binary. Reports
            are not anonymous.
          </p>
          {!consentState.ready && identityReady && (
            <p role="status" className="text-muted-foreground text-sm">
              Checking the profile consent setting. App error reporting is off
              until it can be confirmed.
            </p>
          )}
          {incognito &&
            identityReady &&
            consentState.ready &&
            !consentState.error &&
            scopeMessage && (
              <p role="status" className="text-muted-foreground text-sm">
                {scopeMessage}
              </p>
            )}
          {consentState.profileEnabled &&
            !consentState.appGrantEnabled &&
            !incognito && (
              <p role="status" className="text-muted-foreground text-sm">
                Profile consent is enabled. App error reporting remains off
                until the local service confirms it.
              </p>
            )}
          {consentState.ready && consentState.error && (
            <button
              type="button"
              className="text-sm underline underline-offset-4"
              onClick={() => void loadConsent()}
            >
              Retry loading consent
            </button>
          )}
          {consentState.error && (
            <p role="alert" className="text-destructive text-sm">
              {consentState.error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
