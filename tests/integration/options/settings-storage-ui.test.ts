import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SnapshotConfirmationModal from '@/entrypoints/options/components/SnapshotConfirmationModal.vue'

const root = process.cwd()

describe('session snapshot Storage UI', () => {
  it('renders snapshot settings and the split history/tree browser', () => {
    const source = fs.readFileSync(
      path.join(
        root,
        'src/entrypoints/options/components/settings.storage.vue',
      ),
      'utf8',
    )
    expect(source).toContain('Settings.values.automaticSessionSnapshots')
    expect(source).toContain('Settings.values.sessionSnapshotInterval')
    expect(source).toContain('Protect manual snapshots')
    expect(source).toContain('Include private windows')
    expect(source).toContain('Take a snapshot now')
    expect(source).toContain('snapshot-history')
    expect(source).toContain('groupedSnapshots')
    expect(source).toContain('snapshot-group-label')
    expect(source).toContain('snapshot-protected-icon')
    expect(source).toContain('aria-label="Protected snapshot"')
    expect(source).not.toContain("snapshot.protected ? 'Protected' : ''")
    expect(source).toContain('snapshot-toolbar-summary')
    expect(source).toContain('snapshot-meter')
    expect(source).toContain('snapshotBarWidth(snapshot)')
    expect(source).toContain('snapshotDelta(snapshot)')
    expect(source).toMatch(
      /\.snapshot-group-label\s*\{[\s\S]*?color:\s*var\(--options-text-faint\)/,
    )
    expect(source).toMatch(
      /\.snapshot-protected-icon\s*\{[\s\S]*?color:\s*var\(--button-active-background\)/,
    )
    expect(source).toMatch(
      /\.snapshot-toolbar-summary\s*\{[\s\S]*?color:\s*var\(--options-text-muted\)/,
    )
    expect(source).toContain('formatCounts(snapshot.counts)')
    expect(source).toContain('class="snapshot-unavailable-tag"')
    expect(source).toContain('The active session tree is empty')
    expect(source).toContain('SnapshotTree')
    // The empty state must follow the configured schedule, not assume one.
    expect(source).toContain('emptyHistoryMessage')
    expect(source).toContain('Automatic snapshots are off, so take one now.')
    expect(source).not.toContain('One is taken every 30 minutes')
    expect(source).toContain('Pick a snapshot to see what it contains.')
    expect(source).toMatch(/\.snapshot-browser\s*\{[\s\S]*?height:\s*528px/)
    expect(source).toMatch(
      /\.snapshot-preview\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column[\s\S]*?min-height:\s*0/,
    )
    expect(source).toMatch(
      /\.snapshot-preview-toolbar\s*\{[\s\S]*?flex:\s*0 0 auto/,
    )
    expect(source).toMatch(/\.snapshot-history\s*\{[\s\S]*?overflow-y:\s*auto/)
    expect(source).toMatch(
      /\.snapshot-history\s*\{[\s\S]*?overflow-x:\s*hidden/,
    )
    expect(source).toMatch(
      /\.snapshot-entry\s*\{[\s\S]*?box-sizing:\s*border-box/,
    )
    expect(source).toContain("'Restore everything'")
    expect(source).toContain(
      "`Restore ${pluralize(selectedUids.value.length, 'item')}`",
    )
    // The restore button and the dialog it opens must read from one source so
    // their wording cannot drift apart.
    expect(source).toContain('{{ restoreLabel }}')
    expect(source).toContain('title: restoreLabel.value')
    expect(source).toContain('confirmLabel: restoreLabel.value')
    expect(source).not.toContain("'Restore Selected Items'")
    expect(source).not.toContain("'Restore Entire Snapshot'")
    expect(source).toContain('snapshot-selected-actions')
    expect(source).toContain('Save as JSON')
    expect(source).toContain('Delete this snapshot')
    expect(source).toContain('toFixed(2)')
    expect(source).toContain('snapshot-success-toast')
    expect(source).toMatch(
      /\.snapshot-success-toast\s*\{[\s\S]*?top:\s*18px[\s\S]*?left:\s*50%[\s\S]*?transform:\s*translateX\(-50%\)/,
    )
    expect(source).not.toMatch(
      /\.snapshot-success-toast\s*\{[\s\S]*?right:\s*18px/,
    )
    expect(source).toContain('3_000')
    expect(source).toContain("kind: 'error'")
    expect(source).toContain('onBeforeUnmount')
    expect(source).not.toContain('--text-color-secondary')
    expect(source).toContain('SessionSnapshotClient.restoreSummary')
    expect(source).toContain('Append ${formatCountsSentence(counts)}')
    // Prose counts are pluralised and omit item types the snapshot lacks.
    expect(source).toContain("if (parts.length === 0) return 'nothing'")
    expect(source).not.toContain('${counts.windows} windows')
    expect(source).toMatch(
      /SessionSnapshotClient\.get\(id\)[\s\S]*?current\.available = false/,
    )
    expect(source).toMatch(
      /await run\(\(\) =>\s*SessionSnapshotClient\.restoreSummary/,
    )
    expect(source).toContain('SnapshotConfirmationModal')
    expect(source).not.toContain('window.confirm')
    expect(source).toContain('aria-live="polite"')
  })

  it('renders snapshot errors as a persistent dismiss-only dialog', async () => {
    const markup = await renderToString(
      createSSRApp(SnapshotConfirmationModal, {
        kind: 'error',
        title: 'Snapshot Failed',
        message: 'The snapshot could not be restored.',
      }),
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Snapshot Failed')
    expect(markup).toContain('The snapshot could not be restored.')
    expect(markup).toContain('Dismiss')
    expect(markup).not.toContain('Cancel')
  })

  it('activates the Storage section in the options page', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/entrypoints/options/options.vue'),
      'utf8',
    )
    expect(source).toContain(
      "import SettingsStorage from './components/settings.storage.vue'",
    )
    expect(source).toContain('<SettingsStorage />')
  })
})
