import process from 'node:process'
import { config as baseConfig } from './wdio.conf.mjs'
import {
  createPersistentFirefoxProfile,
  removePersistentFirefoxProfile,
} from './tests/e2e/support/persistent-firefox-profile.mjs'

const profilePath =
  process.env.WDIO_RESTART_PROFILE || createPersistentFirefoxProfile()
process.env.WDIO_RESTART_PROFILE = profilePath

const capabilities = baseConfig.capabilities.map((capability) => {
  const firefoxOptions = capability['moz:firefoxOptions']
  return {
    ...capability,
    'moz:firefoxOptions': {
      ...firefoxOptions,
      args: [...(firefoxOptions.args ?? []), '-profile', profilePath],
      prefs: {
        ...firefoxOptions.prefs,
        'browser.startup.page': 3,
        'browser.sessionstore.resume_from_crash': true,
        'browser.warnOnQuit': false,
      },
    },
  }
})

export const config = {
  ...baseConfig,
  specs: ['./tests/e2e/startup-persistence.spec.mjs'],
  exclude: [],
  capabilities,
  mochaOpts: {
    ...baseConfig.mochaOpts,
    timeout: 120_000,
  },
  onComplete: async (...args) => {
    try {
      await baseConfig.onComplete?.(...args)
    } finally {
      removePersistentFirefoxProfile(profilePath)
    }
  },
}
