import fs from 'node:fs/promises'
import path from 'node:path'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it } from 'vitest'
import DeleteTreeItemsModal from '@/components/DeleteTreeItemsModal.vue'
import {
  closeModal,
  ModalState,
  openDeleteTreeItemsModal,
} from '@/services/modal-state'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
} from '../../helpers/foreground-tree-fixtures'

describe('Delete tree items confirmation', () => {
  beforeEach(() => closeModal())

  it('captures immutable UIDs and item counts independently of selection', () => {
    const items = [
      makeForegroundTab('tab-1' as UID),
      makeForegroundNote('note-1' as UID),
      makeForegroundSeparator('separator-1' as UID),
    ]

    openDeleteTreeItemsModal(items)
    items.splice(0)

    expect(ModalState.active).toEqual({
      kind: 'deleteTreeItems',
      itemUids: ['tab-1', 'note-1', 'separator-1'],
      counts: { windows: 0, tabs: 1, notes: 1, separators: 1 },
    })
  })

  it('renders an accessible danger confirmation with the affected counts', async () => {
    const markup = await renderToString(
      createSSRApp(DeleteTreeItemsModal, {
        counts: { windows: 1, tabs: 2, notes: 3, separators: 4 },
      }),
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Delete Selected Items')
    expect(markup).toContain('1 window, 2 tabs, 3 notes, and 4 separators')
    expect(markup).toContain('Delete')
    expect(markup).toContain('Cancel')
    expect(markup).toContain('delete-tree-items-confirm')
  })

  it('omits zero-count item types from the deletion summary', async () => {
    const markup = await renderToString(
      createSSRApp(DeleteTreeItemsModal, {
        counts: { windows: 0, tabs: 1, notes: 0, separators: 2 },
      }),
    )

    expect(markup).toContain('This will delete 1 tab and 2 separators.')
    expect(markup).not.toContain('0 windows')
    expect(markup).not.toContain('0 notes')
  })

  it('wires confirmation and cancellation through SessionTree', async () => {
    const source = await fs.readFile(
      path.resolve(
        process.cwd(),
        'src/entrypoints/sessiontree/SessionTree.vue',
      ),
      'utf8',
    )

    expect(source).toContain("ModalState.active?.kind === 'deleteTreeItems'")
    expect(source).toContain('<DeleteTreeItemsModal')
    const handler = source.slice(
      source.indexOf('async function handleDeleteTreeItemsConfirm'),
      source.indexOf('\nfunction runToolbarAction'),
    )
    expect(handler).toContain('await Messages.deleteTreeItems(itemUids)')
    expect(handler).not.toContain('if (deleted)')
    expect(handler).toMatch(
      /finally\s*{[\s\S]*closeModal\(\)[\s\S]*Selection\.clearSelection\(\)[\s\S]*deleteTreeItemsPending\.value = false/,
    )
    expect(source).toContain('const blockingModalActive = computed(')
    expect(source).toContain("ModalState.active?.kind === 'deleteTreeItems'")
    expect(source.match(/:inert="blockingModalActive"/g)).toHaveLength(3)
    expect(source).toContain('@cancel="closeModal()"')
  })

  it('traps keyboard focus within enabled dialog actions', async () => {
    const source = await fs.readFile(
      path.resolve(process.cwd(), 'src/components/DeleteTreeItemsModal.vue'),
      'utf8',
    )

    expect(source).toContain("if (event.key !== 'Tab') return")
    expect(source).toContain('querySelectorAll<HTMLElement>(')
    expect(source).toContain("'button:not([disabled])'")
    expect(source).toContain('event.shiftKey')
    expect(source).toContain('last.focus()')
    expect(source).toContain('first.focus()')
  })

  it('restores focus to a connected origin or surviving tree fallback', async () => {
    const source = await fs.readFile(
      path.resolve(process.cwd(), 'src/components/DeleteTreeItemsModal.vue'),
      'utf8',
    )

    expect(source).toContain('previouslyFocused?.isConnected')
    expect(source).toContain(
      "document.querySelector<HTMLElement>('.tree-item')",
    )
    expect(source).toContain(
      "document.querySelector<HTMLElement>('.sessiontree-content')",
    )
  })
})
