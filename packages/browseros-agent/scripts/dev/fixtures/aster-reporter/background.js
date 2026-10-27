const ASTER_EXTENSION_ID = 'oifdmombnijnaiocijiacjhajbnpdlhb'
const REPORTER_VERSION_REQUEST = 'browseros:diagnostics:reporter-version'
const FIXTURE_VERSION = 'aster-reporter-fixture/1.0.0'

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (
      sender.id !== ASTER_EXTENSION_ID ||
      message?.type !== REPORTER_VERSION_REQUEST
    ) {
      return false
    }

    sendResponse({ version: FIXTURE_VERSION })
    return false
  },
)
