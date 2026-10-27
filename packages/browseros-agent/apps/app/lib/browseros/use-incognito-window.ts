import { useEffect, useState } from 'react'
import { isIncognitoWindow } from './incognito'

/** Start private until the owning browser window has been positively checked. */
export function useIncognitoWindow(): boolean {
  const [incognito, setIncognito] = useState(true)

  useEffect(() => {
    let cancelled = false
    isIncognitoWindow().then((result) => {
      if (!cancelled) setIncognito(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return incognito
}
