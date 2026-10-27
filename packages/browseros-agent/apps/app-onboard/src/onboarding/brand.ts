export const ONBOARDING_BRAND =
  import.meta.env.MODE === 'aster-chromium' ? 'Aster' : 'BrowserOS'

export const ONBOARDING_LOGO_PATH =
  import.meta.env.MODE === 'aster-chromium'
    ? '/icon/aster-mark.svg'
    : '/icon/128.png'
