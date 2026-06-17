import { browser } from '@wdio/globals'

export async function withFirefoxChromeContext(callback) {
  await setFirefoxContext('chrome')

  try {
    return await callback()
  } finally {
    await setFirefoxContext('content')
  }
}

export async function clickFirefoxExtensionAction(extensionId) {
  return withFirefoxChromeContext(async () =>
    executeFirefoxChromeScript(
      (id) => {
        const { ExtensionParent } = ChromeUtils.importESModule(
          'resource://gre/modules/ExtensionParent.sys.mjs',
        )
        const browserWindow =
          window.BrowserWindowTracker?.getTopWindow?.() ?? window
        const extension = ExtensionParent.GlobalManager.getExtension(id)
        const browserAction =
          extension &&
          ExtensionParent.apiManager.global.browserAction.for(extension)

        if (browserAction) {
          browserAction.action.dispatchClick(
            browserWindow.gBrowser.selectedTab,
            {
              button: 0,
              modifiers: [],
            },
          )
          return
        }

        const document = browserWindow.document
        const widgetIds = [
          `${id}-browser-action`,
          `${id.replaceAll('@', '_')}-browser-action`,
        ]
        const button =
          widgetIds
            .map((widgetId) => document.getElementById(widgetId))
            .find(Boolean) ??
          Array.from(document.querySelectorAll('[id$="-browser-action"]')).find(
            (element) =>
              element.getAttribute('label') === 'Session Flow' ||
              element.getAttribute('tooltiptext') === 'Session Flow' ||
              element.getAttribute('aria-label') === 'Session Flow' ||
              element.getAttribute('title') === 'Session Flow',
          )

        if (!button) {
          const availableActions = Array.from(
            document.querySelectorAll('[id$="-browser-action"]'),
          ).map((element) => ({
            id: element.id,
            label: element.getAttribute('label'),
            tooltip: element.getAttribute('tooltiptext'),
            ariaLabel: element.getAttribute('aria-label'),
            title: element.getAttribute('title'),
          }))

          throw new Error(
            `Extension toolbar button was not found. Tried ${widgetIds.join(
              ', ',
            )}. Available actions: ${JSON.stringify(availableActions)}`,
          )
        }

        button.click()
      },
      [extensionId],
    ),
  )
}

async function setFirefoxContext(context) {
  const response = await fetch(
    `${getWebDriverBaseUrl()}/session/${browser.sessionId}/moz/context`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ context }),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to switch Firefox context to ${context}: ${response.status} ${await response.text()}`,
    )
  }
}

function getWebDriverBaseUrl() {
  const protocol = browser.options.protocol ?? 'http'
  const hostname = browser.options.hostname ?? 'localhost'
  const port = browser.options.port
  const basePath = browser.options.path ?? '/'
  const normalizedPath = basePath.endsWith('/')
    ? basePath.slice(0, -1)
    : basePath

  return `${protocol}://${hostname}:${port}${normalizedPath}`
}

async function executeFirefoxChromeScript(scriptFunction, args = []) {
  const response = await fetch(
    `${getWebDriverBaseUrl()}/session/${browser.sessionId}/execute/sync`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        script: `return (${scriptFunction.toString()})(...arguments)`,
        args,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to execute Firefox chrome script: ${response.status} ${await response.text()}`,
    )
  }

  return response.json()
}
