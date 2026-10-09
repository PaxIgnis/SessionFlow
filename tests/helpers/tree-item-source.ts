import { readFile } from 'node:fs/promises'

export async function readTreeItemSource(): Promise<string> {
  const parts = await Promise.all([
    readFile(
      new URL('../../src/components/TreeItem.vue', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../src/styles/tree-item.css', import.meta.url),
      'utf8',
    ),
  ])
  return parts.join('\n')
}
