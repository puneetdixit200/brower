const ASTER_EXTENSION_ID = 'oifdmombnijnaiocijiacjhajbnpdlhb'

window.probeAsterDiagnostics = () =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(
      ASTER_EXTENSION_ID,
      {
        type: 'browseros:diagnostics:get',
        maxAgeMs: 0,
        timestamp: Date.now(),
      },
      (response) => {
        resolve({
          response: response ?? null,
          error: chrome.runtime.lastError?.message ?? null,
        })
      },
    )
  })
