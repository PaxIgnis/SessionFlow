import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { writeFirefoxStdoutLine } from './firefox-chrome-context.mjs'

/**
 * Firefox only keeps an extension's console calls in the extension process,
 * where WebDriver cannot read them. With devtools.console.stdout.content set,
 * Firefox also prints them to stdout, which geckodriver records in its log in
 * outputDir. Each test writes a marker there, and a failed test prints what
 * came after its marker, so CI failures show what the background saw.
 */
export const E2E_LOG_DIRECTORY = '.output/e2e-logs'

const TEST_MARKER = '[SF-E2E] test started:'
const MAX_PRINTED_LINES = 400
const MAX_LINE_LENGTH = 600
const NOISE = [
  /^console\.error: "Experiment .* has unknown featureId/,
  /NavigationManager\.sys\.mjs/,
  /JSWindowActorChild cannot send at the moment/,
  /nsIContentSniffer\.getMIMETypeFromContent/,
]

export const firefoxConsolePrefs = {
  'devtools.console.stdout.content': true,
  'browser.dom.window.dump.enabled': true,
}

function testMarker(test) {
  return `${TEST_MARKER} ${[test.parent, test.title].filter(Boolean).join(' › ')}`
}

export async function markTestStart(test) {
  try {
    await writeFirefoxStdoutLine(testMarker(test))
  } catch {
    // The marker is diagnostic only; a test must not fail because of it.
  }
}

export async function printFirefoxConsoleOnFailure(test, result) {
  if (result?.passed !== false) return

  let log
  try {
    log = await fs.readFile(await geckodriverLogPath(), 'utf8')
  } catch (error) {
    console.log(
      `Could not read the Firefox console for "${test.title}": ${error?.message ?? error}`,
    )
    return
  }

  const lines = log.split(/\r?\n/)
  const start = lines.lastIndexOf(testMarker(test))
  const relevant = lines
    .slice(start + 1)
    .filter(
      (line) =>
        /^(console\.\w+:|JavaScript (error|warning):)/.test(line) &&
        !NOISE.some((pattern) => pattern.test(line)),
    )
    .map((line) =>
      line.length > MAX_LINE_LENGTH
        ? `${line.slice(0, MAX_LINE_LENGTH)}…`
        : line,
    )
  const shown = relevant.slice(-MAX_PRINTED_LINES)
  const omitted = relevant.length - shown.length
  console.log(
    [
      `--- Firefox console during failed test "${test.title}"${start < 0 ? ' (test start marker missing; showing the whole log)' : ''}${omitted > 0 ? ` (first ${omitted} line(s) omitted)` : ''} ---`,
      ...shown.map((line) => `  ${line}`),
      '--- End of Firefox console ---',
    ].join('\n'),
  )
}

async function geckodriverLogPath() {
  const workerLog = path.join(
    E2E_LOG_DIRECTORY,
    `wdio-${process.env.WDIO_WORKER_ID}-geckodriver.log`,
  )
  try {
    await fs.access(workerLog)
    return workerLog
  } catch {
    const entries = await fs.readdir(E2E_LOG_DIRECTORY)
    const logs = entries.filter((entry) => entry.endsWith('-geckodriver.log'))
    if (logs.length === 0) throw new Error('No geckodriver log was written.')
    return path.join(E2E_LOG_DIRECTORY, logs.sort().at(-1))
  }
}
