import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import istanbulCoverage from 'istanbul-lib-coverage'
import istanbulReport from 'istanbul-lib-report'
import istanbulReports from 'istanbul-reports'

const defaultCoverageDir = path.join(process.cwd(), 'coverage')
const defaultE2eCoverageDir = path.join(process.cwd(), 'coverage-e2e')
const defaultCombinedCoverageDir = path.join(process.cwd(), 'coverage-all')

export async function mergeCoverageReports({
  coverageDir = defaultCoverageDir,
  e2eCoverageDir = defaultE2eCoverageDir,
  combinedCoverageDir = defaultCombinedCoverageDir,
  projectRoot = process.cwd(),
} = {}) {
  const mergedCoverage = normalizeCoverageMap(
    await readCoverageJson(path.join(coverageDir, 'coverage-final.json')),
    projectRoot,
  )

  for (const fileName of await readDirectoryIfExists(
    path.join(e2eCoverageDir, '.raw'),
  )) {
    if (!fileName.endsWith('.json')) continue

    mergeCoverageInto(
      mergedCoverage,
      normalizeCoverageMap(
        await readCoverageJson(path.join(e2eCoverageDir, '.raw', fileName)),
        projectRoot,
      ),
    )
  }

  const coverageMap = istanbulCoverage.createCoverageMap(mergedCoverage)

  await fs.rm(combinedCoverageDir, { force: true, recursive: true })
  await fs.mkdir(combinedCoverageDir, { recursive: true })
  await fs.writeFile(
    path.join(combinedCoverageDir, 'coverage-final.json'),
    JSON.stringify(coverageMap.toJSON()),
  )

  const context = istanbulReport.createContext({
    coverageMap,
    dir: combinedCoverageDir,
  })

  istanbulReports.create('text').execute(context)
  istanbulReports.create('html').execute(context)
  istanbulReports.create('lcovonly', { file: 'lcov.info' }).execute(context)
  istanbulReports
    .create('json-summary', { file: 'coverage-summary.json' })
    .execute(context)

  return coverageMap
}

function normalizeCoverageMap(rawCoverageMap, projectRoot) {
  const normalized = {}

  for (const [sourceFile, fileCoverage] of Object.entries(rawCoverageMap)) {
    const normalizedSourceFile = normalizeSourceFile(sourceFile, projectRoot)
    normalized[normalizedSourceFile] = {
      ...fileCoverage,
      path: normalizedSourceFile,
    }
  }

  return normalized
}

function mergeCoverageInto(targetCoverageMap, sourceCoverageMap) {
  for (const [sourceFile, sourceCoverage] of Object.entries(
    sourceCoverageMap,
  )) {
    if (!targetCoverageMap[sourceFile]) {
      targetCoverageMap[sourceFile] = sourceCoverage
      continue
    }

    targetCoverageMap[sourceFile] = mergeFileCoverage(
      targetCoverageMap[sourceFile],
      sourceCoverage,
    )
  }
}

function mergeFileCoverage(targetCoverage, sourceCoverage) {
  if (coverageMapsMatch(targetCoverage, sourceCoverage)) {
    const sourceFile = targetCoverage.path
    const coverageMap = istanbulCoverage.createCoverageMap({
      [sourceFile]: targetCoverage,
    })

    coverageMap.merge({ [sourceFile]: sourceCoverage })

    return coverageMap.toJSON()[sourceFile]
  }

  return mergeStatementHitsByLine(targetCoverage, sourceCoverage)
}

function coverageMapsMatch(targetCoverage, sourceCoverage) {
  return (
    JSON.stringify(targetCoverage.statementMap) ===
      JSON.stringify(sourceCoverage.statementMap) &&
    JSON.stringify(targetCoverage.fnMap) ===
      JSON.stringify(sourceCoverage.fnMap) &&
    JSON.stringify(targetCoverage.branchMap) ===
      JSON.stringify(sourceCoverage.branchMap)
  )
}

function mergeStatementHitsByLine(targetCoverage, sourceCoverage) {
  const mergedCoverage = structuredClone(targetCoverage)
  const sourceLineHits = collectStatementHitsByLine(sourceCoverage)

  for (const [statementId, statementLocation] of Object.entries(
    mergedCoverage.statementMap,
  )) {
    const sourceHits = sourceLineHits.get(statementLocation.start.line) ?? 0

    if (sourceHits > 0) {
      mergedCoverage.s[statementId] =
        (mergedCoverage.s[statementId] ?? 0) + sourceHits
    }
  }

  return mergedCoverage
}

function collectStatementHitsByLine(fileCoverage) {
  const lineHits = new Map()

  for (const [statementId, statementLocation] of Object.entries(
    fileCoverage.statementMap,
  )) {
    const hits = fileCoverage.s[statementId] ?? 0

    if (hits <= 0) continue

    for (
      let line = statementLocation.start.line;
      line <= statementLocation.end.line;
      line += 1
    ) {
      lineHits.set(line, Math.max(lineHits.get(line) ?? 0, hits))
    }
  }

  return lineHits
}

function normalizeSourceFile(sourceFile, projectRoot) {
  const normalizedProjectRoot = projectRoot
    .replaceAll('\\', '/')
    .replace(/\/$/, '')
  let normalizedSourceFile = sourceFile.replaceAll('\\', '/')

  if (
    normalizedSourceFile
      .toLowerCase()
      .startsWith(`${normalizedProjectRoot.toLowerCase()}/`)
  ) {
    normalizedSourceFile = normalizedSourceFile.slice(
      normalizedProjectRoot.length + 1,
    )
  }

  return normalizedSourceFile.replace(/^\.\//, '')
}

async function readCoverageJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function readDirectoryIfExists(directoryPath) {
  try {
    return await fs.readdir(directoryPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mergeCoverageReports()
}
