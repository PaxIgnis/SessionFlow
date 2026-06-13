import { browser } from '@wdio/globals'
import istanbulCoverage from 'istanbul-lib-coverage'
import istanbulReport from 'istanbul-lib-report'
import istanbulReports from 'istanbul-reports'
import fs from 'node:fs/promises'
import path from 'node:path'

const coverageEnabled = process.env.E2E_COVERAGE === 'true'
const coverageDirectory = path.join(process.cwd(), 'coverage-e2e')
const rawCoverageDirectory = path.join(coverageDirectory, '.raw')
const htmlCoverageDirectory = path.join(coverageDirectory, 'html')

let coverageFileIndex = 0

export async function resetE2eCoverage() {
  if (!coverageEnabled) return

  await fs.rm(coverageDirectory, { force: true, recursive: true })
  await fs.mkdir(rawCoverageDirectory, { recursive: true })
}

export async function collectCoverageFromOpenWindows(label = 'window') {
  if (!coverageEnabled) return

  const originalHandle = await safeGetWindowHandle()
  const handles = await browser.getWindowHandles()

  for (const handle of handles) {
    try {
      await browser.switchToWindow(handle)
      await collectCoverageFromCurrentWindow(`${label}-${handle}`)
    } catch {
      // Windows can close while test cleanup is running.
    }
  }

  if (
    originalHandle &&
    (await browser.getWindowHandles()).includes(originalHandle)
  ) {
    await browser.switchToWindow(originalHandle)
  }
}

export async function collectCoverageFromCurrentWindow(label = 'window') {
  if (!coverageEnabled) return

  const coverage = await coverageFromCurrentWindow()
  const backgroundCoverage = await coverageFromBackgroundPage()

  await writeRawCoverage(coverage, label)
  await writeRawCoverage(backgroundCoverage, `${label}-background`)
}

export async function writeE2eCoverageReport() {
  if (!coverageEnabled) return

  const coverageMap = istanbulCoverage.createCoverageMap({})
  let entries = []

  try {
    entries = await fs.readdir(rawCoverageDirectory)
  } catch {
    entries = []
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue

    const rawCoverage = JSON.parse(
      await fs.readFile(path.join(rawCoverageDirectory, entry), 'utf8'),
    )
    coverageMap.merge(rawCoverage)
  }

  const fileContext = istanbulReport.createContext({
    coverageMap,
    dir: coverageDirectory,
  })
  const htmlContext = istanbulReport.createContext({
    coverageMap,
    dir: htmlCoverageDirectory,
  })

  istanbulReports.create('text').execute(fileContext)
  istanbulReports.create('html').execute(htmlContext)
  istanbulReports.create('lcovonly', { file: 'lcov.info' }).execute(fileContext)
  istanbulReports
    .create('json', { file: 'coverage-final.json' })
    .execute(fileContext)
  istanbulReports
    .create('json-summary', { file: 'coverage-summary.json' })
    .execute(fileContext)
}

async function coverageFromCurrentWindow() {
  return browser.execute(() => window.__coverage__)
}

async function coverageFromBackgroundPage() {
  return browser.executeAsync((done) => {
    if (!window.browser?.runtime?.getBackgroundPage) {
      done(undefined)
      return
    }

    window.browser.runtime
      .getBackgroundPage()
      .then((backgroundPage) => done(backgroundPage?.__coverage__))
      .catch(() => done(undefined))
  })
}

async function writeRawCoverage(coverage, label) {
  if (!coverage || Object.keys(coverage).length === 0) return

  await fs.mkdir(rawCoverageDirectory, { recursive: true })
  const fileName = `${String(coverageFileIndex).padStart(4, '0')}-${sanitizeLabel(
    label,
  )}.json`
  coverageFileIndex += 1
  await fs.writeFile(
    path.join(rawCoverageDirectory, fileName),
    JSON.stringify(coverage),
  )
}

async function safeGetWindowHandle() {
  try {
    return await browser.getWindowHandle()
  } catch {
    return undefined
  }
}

function sanitizeLabel(label) {
  return label.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-|-$/g, '')
}
