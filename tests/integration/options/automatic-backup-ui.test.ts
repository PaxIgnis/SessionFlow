import { beforeEach, describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import SettingsBackup from '@/entrypoints/options/components/settings.backup.vue'
import { Settings } from '@/services/settings'
import { installFakeBrowser } from '../../helpers/fake-browser'

function render() {
  return renderToString(createSSRApp(SettingsBackup))
}

function automaticSettings(markup: string) {
  return markup.match(
    /<div[^>]*data-testid="automatic-backup-settings"[^>]*>/,
  )?.[0]
}

describe('automatic backup settings', () => {
  beforeEach(() => {
    installFakeBrowser()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('offers the schedule, folder and number of backups to keep', async () => {
    Settings.values.automaticBackups = true
    Settings.values.automaticBackupFolder = 'Backups/Session Flow'

    const markup = await render()

    expect(markup).toContain('Back up automatically')
    expect(markup).toContain('Back up every')
    expect(markup).toContain('Backups to keep')
    expect(markup).toMatch(
      /data-testid="automatic-backup-folder"[^>]*value="Backups\/Session Flow"|value="Backups\/Session Flow"[^>]*data-testid="automatic-backup-folder"/,
    )
    expect(automaticSettings(markup)).toContain('data-disabled="false"')
    expect(automaticSettings(markup)).not.toContain('inert')
  })

  it('disables the automatic backup controls while turned off', async () => {
    const markup = await render()

    expect(automaticSettings(markup)).toContain('data-disabled="true"')
    expect(automaticSettings(markup)).toContain('inert')
    expect(markup).toMatch(
      /<button[^>]*data-testid="automatic-backup-now"[^>]*disabled/,
    )
  })
})
