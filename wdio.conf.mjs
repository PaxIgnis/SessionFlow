import process from 'process'
import {
  FIREFOX_EXTENSION_ID,
  FIREFOX_EXTENSION_UUID,
  installSessionFlowAddon,
} from './tests/e2e/support/firefox-extension.mjs'
import {
  collectCoverageFromOpenWindows,
  resetE2eCoverage,
  writeE2eCoverageReport,
} from './tests/e2e/support/e2e-coverage.mjs'

const isHeadlessRun = process.env.WDIO_HEADLESS === 'true'

export const config = {
  runner: 'local',
  specs: ['./tests/e2e/**/*.spec.mjs'],
  exclude: ['./tests/e2e/startup-persistence.spec.mjs'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'firefox',
      acceptInsecureCerts: true,
      'moz:firefoxOptions': {
        args: isHeadlessRun
          ? ['-headless', '-remote-allow-system-access']
          : ['-remote-allow-system-access'],
        ...(process.env.WDIO_FIREFOX_BINARY
          ? { binary: process.env.WDIO_FIREFOX_BINARY }
          : {}),
        prefs: {
          'extensions.webextensions.uuids': JSON.stringify({
            [FIREFOX_EXTENSION_ID]: FIREFOX_EXTENSION_UUID,
          }),
          'xpinstall.signatures.required': false,
        },
      },
    },
  ],
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60_000,
  },
  onPrepare: async () => {
    if (process.env.E2E_COVERAGE_APPEND !== 'true') {
      await resetE2eCoverage()
    }
  },
  before: async (capabilities) => {
    if (capabilities.browserName === 'firefox') {
      const addonId = await installSessionFlowAddon()
      console.log(`Installed SessionFlow Firefox add-on: ${addonId}`)
    }
  },
  afterTest: async (test) => {
    await collectCoverageFromOpenWindows(test.title)
  },
  onComplete: async () => {
    await writeE2eCoverageReport()
  },
}
