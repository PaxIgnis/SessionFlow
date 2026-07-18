import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { browser } from '@wdio/globals'

export const FIREFOX_EXTENSION_ID =
  '6b9a5897787af169ae058e65c75ac90a98506c61@session-flow'
export const FIREFOX_EXTENSION_UUID = '11111111-1111-4111-8111-111111111111'
export const SESSION_TREE_URL = `moz-extension://${FIREFOX_EXTENSION_UUID}/sessiontree.html`

export async function installSessionFlowAddon() {
  const extensionPath = await findFirefoxExtensionPackage()
  const extension = await fs.readFile(extensionPath)
  return browser.installAddOn(extension.toString('base64'), false)
}

async function findFirefoxExtensionPackage() {
  const outputDir = path.join(process.cwd(), '.output')
  const fileNames = await fs.readdir(outputDir)
  const firefoxPackages = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('-firefox.zip'))
      .map(async (fileName) => {
        const packagePath = path.join(outputDir, fileName)
        const stats = await fs.stat(packagePath)
        return { packagePath, modifiedAt: stats.mtimeMs }
      }),
  )

  firefoxPackages.sort((left, right) => right.modifiedAt - left.modifiedAt)

  if (!firefoxPackages[0]) {
    throw new Error(
      'Firefox extension package was not found. Run `pnpm run zip:firefox` first.',
    )
  }

  return firefoxPackages[0].packagePath
}
