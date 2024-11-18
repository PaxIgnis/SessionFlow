import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: 'chrome',
  manifest: {
    action: {
      default_title: 'Some Title',
    },
    permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
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
  // },
  srcDir: 'src',
})
