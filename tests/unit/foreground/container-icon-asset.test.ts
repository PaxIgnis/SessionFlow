import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
)

describe('Firefox container icon asset', () => {
  it('matches Mozilla usercontext.svg with only the fill color adapted', async () => {
    const source = await fs.readFile(
      path.resolve(repositoryRoot, 'public/icons/usercontext.svg'),
      'utf8',
    )

    expect(createHash('sha256').update(source).digest('hex')).toBe(
      '093b74276380b983aef588fbf7fac1f7339b7f72e6f6c8d08c3965ee0800eb98',
    )
  })
})
