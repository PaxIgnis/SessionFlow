import createSvgSpritePlugin from 'vite-plugin-svg-sprite'
import istanbul from 'vite-plugin-istanbul'
import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    action: {
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
      },
      default_title: 'Session Flow',
    },
    permissions: [
      'activeTab',
      'alarms',
      'menus',
      'menus.overrideContext',
      'scripting',
      'storage',
      'tabGroups',
      'tabs',
    ],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    optional_permissions: ['http://*/*' as never, 'https://*/*' as never],
    name: 'Session Flow',
    browser_specific_settings: {
      gecko: {
        id: '6b9a5897787af169ae058e65c75ac90a98506c61@temporary-addon',
        strict_min_version: '139.0',
      },
    },
  },
  modules: ['@wxt-dev/module-vue'],
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
})
