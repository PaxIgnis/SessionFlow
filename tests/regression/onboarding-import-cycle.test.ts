import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Vitest's module runner can mask native ESM temporal-dead-zone errors.
// Keep this import cycle intact, stubbing only unrelated service boundaries.
function loadNativeDragModule(entry: string) {
  const directory = mkdtempSync(join(tmpdir(), 'sessionflow-esm-'))
  const sources = [
    'onboarding-animation',
    'drag-and-drop',
    'drag-and-drop-actions',
    'drag-and-drop-presentation',
  ].map((name) => resolve('src/services', `${name}.ts`))

  const boundaries = new Map<string, { file: string; names: Set<string> }>()
  function dependency(specifier: string, importer: string, names: string[]) {
    const source = specifier.startsWith('@/')
      ? resolve('src', specifier.slice(2)) + '.ts'
      : resolve(importer, '..', specifier) + '.ts'
    if (sources.includes(source)) return './' + basename(source, '.ts') + '.mjs'
    let boundary = boundaries.get(source)
    if (!boundary) {
      boundary = { file: `boundary-${boundaries.size}.mjs`, names: new Set() }
      boundaries.set(source, boundary)
    }
    names.forEach((name) => boundary.names.add(name))
    return './' + boundary.file
  }
  try {
    for (const source of sources) {
      const output = ts.transpileModule(readFileSync(source, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        transformers: {
          before: [
            (context) => (file) =>
              ts.visitEachChild(
                file,
                (node) => {
                  if (
                    ts.isImportDeclaration(node) &&
                    ts.isStringLiteral(node.moduleSpecifier)
                  ) {
                    const bindings = node.importClause?.namedBindings
                    const names =
                      bindings && ts.isNamedImports(bindings)
                        ? bindings.elements.map(
                            (item) => item.propertyName?.text ?? item.name.text,
                          )
                        : []
                    if (node.importClause?.name) names.push('default')
                    const target = dependency(
                      node.moduleSpecifier.text,
                      source,
                      names,
                    )
                    return context.factory.updateImportDeclaration(
                      node,
                      node.modifiers,
                      node.importClause,
                      context.factory.createStringLiteral(target),
                      node.attributes,
                    )
                  }
                  if (
                    ts.isExportDeclaration(node) &&
                    node.moduleSpecifier &&
                    ts.isStringLiteral(node.moduleSpecifier)
                  ) {
                    const names =
                      node.exportClause && ts.isNamedExports(node.exportClause)
                        ? node.exportClause.elements.map(
                            (item) => item.propertyName?.text ?? item.name.text,
                          )
                        : []
                    const target = dependency(
                      node.moduleSpecifier.text,
                      source,
                      names,
                    )
                    return context.factory.updateExportDeclaration(
                      node,
                      node.modifiers,
                      node.isTypeOnly,
                      node.exportClause,
                      context.factory.createStringLiteral(target),
                      node.attributes,
                    )
                  }
                  return node
                },
                context,
              ),
          ],
        },
      }).outputText
      writeFileSync(join(directory, basename(source, '.ts') + '.mjs'), output)
    }
    for (const { file, names } of boundaries.values()) {
      writeFileSync(
        join(directory, file),
        [...names]
          .map((name) =>
            name === 'default'
              ? 'export default {};'
              : `export const ${name} = {};`,
          )
          .join('\n'),
      )
    }
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(pathToFileURL(join(directory, `${entry}.mjs`)).href)})`,
      ],
      { encoding: 'utf8', windowsHide: true, stdio: 'pipe' },
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('development native ESM initialization', () => {
  it.each(['onboarding-animation', 'drag-and-drop', 'drag-and-drop-actions'])(
    'loads %s without reading an uninitialized export',
    (entry) => {
      expect(() => loadNativeDragModule(entry)).not.toThrow()
    },
  )
})
