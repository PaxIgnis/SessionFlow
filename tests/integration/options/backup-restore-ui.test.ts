import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import BackupRestoreModal from '@/entrypoints/options/components/BackupRestoreModal.vue'
import type { BackupPreview } from '@/types/backup'

function render(preview: BackupPreview) {
  return renderToString(createSSRApp(BackupRestoreModal, { preview }))
}

const basePreview: BackupPreview = {
  exportedAt: Date.UTC(2026, 10, 17, 9, 0),
  extensionVersion: '1.2.3',
  invalidSections: [],
  skippedSnapshots: 0,
}

function checkbox(markup: string, section: string) {
  return markup.match(
    new RegExp(`<input[^>]*data-testid="backup-section-${section}"[^>]*>`),
  )?.[0]
}

describe('backup restore dialog', () => {
  it('offers each section in the backup, with what it would change', async () => {
    const markup = await render({
      ...basePreview,
      sessionTree: { counts: { windows: 2, tabs: 5, notes: 0, separators: 0 } },
      snapshots: { total: 12, new: 3 },
      settings: { invalidKeys: 0 },
      favicons: { count: 40 },
    })

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Restore Backup')
    expect(markup).toContain('Session Flow 1.2.3')
    expect(markup).toContain('2 windows and 5 tabs')
    expect(markup).toContain('12 snapshots, 3 new')
    expect(markup).toContain('Replaces all current settings.')
    expect(markup).toContain('40 icons')
    for (const section of [
      'sessionTree',
      'snapshots',
      'settings',
      'favicons',
    ]) {
      expect(checkbox(markup, section)).toContain('checked')
    }
  })

  it('leaves sections out of the dialog when the backup lacks them', async () => {
    const markup = await render({
      ...basePreview,
      settings: { invalidKeys: 2 },
    })

    expect(checkbox(markup, 'settings')).toBeDefined()
    expect(checkbox(markup, 'sessionTree')).toBeUndefined()
    expect(checkbox(markup, 'favicons')).toBeUndefined()
    expect(markup).toContain('2 settings could not be read')
  })

  it('does not preselect snapshots when none of them are new', async () => {
    const markup = await render({
      ...basePreview,
      snapshots: { total: 4, new: 0 },
    })

    expect(checkbox(markup, 'snapshots')).not.toContain('checked')
  })

  it('names sections and snapshots that could not be read', async () => {
    const markup = await render({
      ...basePreview,
      settings: { invalidKeys: 0 },
      invalidSections: ['sessionTree', 'favicons'],
      skippedSnapshots: 1,
    })

    expect(markup).toContain(
      'could not be read and are not offered: Session tree and Favicon cache.',
    )
    expect(markup).toContain('1 snapshot in this backup could not be read')
  })

  it('says when there is nothing to restore and offers only cancel', async () => {
    const markup = await render({
      ...basePreview,
      extensionVersion: '',
      invalidSections: ['settings'],
    })

    expect(markup).toContain(
      'This backup contains nothing that can be restored.',
    )
    expect(markup).not.toContain('Session Flow ')
    expect(markup).not.toContain('data-testid="confirm-backup-restore"')
  })
})
