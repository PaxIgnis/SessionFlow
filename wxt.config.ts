import { defineConfig } from 'wxt'
import createSvgSpritePlugin from 'vite-plugin-svg-sprite'

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: 'chrome',
  manifest: {
    action: {
      default_area: 'navbar',
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
      },
      default_title: 'Session Flow',
    },
    permissions: ['activeTab', 'menus', 'scripting', 'storage', 'tabs'],
    name: 'Session Flow',
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
  vite: () => ({
    plugins: [
      createSvgSpritePlugin({
        exportType: 'vanilla',
        include: ['**/assets/*.svg'],
        symbolId: '[name]',
      }),
    ],
  }),
})
