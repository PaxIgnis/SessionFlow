import { execSync } from 'node:child_process'
import istanbul from 'vite-plugin-istanbul'
import createSvgSpritePlugin from 'vite-plugin-svg-sprite'
import { defineConfig } from 'wxt'

// Keep gitignored files out of the sources zip.
function gitIgnoredPaths(): string[] {
  try {
    return execSync(
      'git ls-files --others --ignored --exclude-standard --directory',
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .map((path) => (path.endsWith('/') ? `${path}**` : path))
  } catch {
    return []
  }
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    commands: {
      'open-session-tree': {
        suggested_key: { default: 'F2' },
        description: '__MSG_openSessionTree__',
      },
      'open-settings': {
        suggested_key: { default: 'Ctrl+F2' },
        description: '__MSG_keyboardOpenSettings__',
      },
      shortcutSnapshot: {
        suggested_key: { default: 'Ctrl+Alt+S' },
        description: '__MSG_shortcutSnapshot__',
      },
    },
    default_locale: 'en',
    description: '__MSG_extensionDescription__',
    icons: {
      '128': 'icon/session-flow.svg',
    },
    action: {
      default_icon: {
        '16': 'icon/session-flow.svg',
        '32': 'icon/session-flow.svg',
        '48': 'icon/session-flow.svg',
      },
      default_title: 'Session Flow',
    },
    incognito: 'spanning',
    permissions: [
      'alarms',
      'contextualIdentities',
      'cookies',
      'menus',
      'menus.overrideContext',
      'sessions',
      'storage',
      'tabGroups',
      'tabs',
      'unlimitedStorage',
    ],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    optional_permissions: [
      'clipboardWrite',
      'http://*/*' as never,
      'https://*/*' as never,
    ],
    name: 'Session Flow',
    browser_specific_settings: {
      gecko: {
        id: '6b9a5897787af169ae058e65c75ac90a98506c61@session-flow',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
  modules: ['@wxt-dev/module-vue', '@wxt-dev/i18n/module'],
  // runner: {
  //   binaries: {
  //     //chrome: '/path/to/chrome-beta', // Use Chrome Beta instead of regular Chrome
  //     firefox: "C:\\Program Files (x86)\\Aurora\\firefox.exe", // Use Firefox Developer Edition instead of regular Firefox
  //     //edge: '/path/to/edge', // Open MS Edge when running "wxt -b edge"
  //   },
  //   firefoxPrefs: {
  //     "remote-debugging-port": "9229",
  //   },
  //   firefoxArgs: ["no-config-discovery"],
  // firefoxProfile: 'SessionFlow',
  // firefoxArgs: ['profile-create-if-missing'],
  // },
  srcDir: 'src',
  vite: () => {
    const plugins = [
      createSvgSpritePlugin({
        exportType: 'vanilla',
        include: ['**/assets/*.svg'],
        symbolId: '[name]',
      }),
    ]

    if (process.env.E2E_COVERAGE === 'true') {
      plugins.push(
        istanbul({
          include: ['src/**/*'],
          exclude: ['tests/**/*', 'node_modules/**/*'],
          extension: ['.js', '.ts', '.vue'],
          requireEnv: false,
          forceBuildInstrument: true,
        }),
      )
    }

    return { plugins }
  },
  zip: {
    artifactTemplate: '{{name}}-{{version}}.zip',
    excludeSources: gitIgnoredPaths(),
  },
})
