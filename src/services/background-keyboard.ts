import { Tree } from '@/services/background-tree'
import { SessionSnapshots } from '@/services/background-session-snapshots'
import { i18n } from '@/services/i18n'
import type { KeyboardNotification } from '@/types/keyboard'

async function notify(message: string): Promise<void> {
  const notification: KeyboardNotification = {
    action: 'keyboard-notification',
    message,
  }
  // No extension page needs to be open for a Firefox command to succeed.
  await browser.runtime.sendMessage(notification).catch(() => undefined)
}

export function initializeKeyboardCommands(ready: Promise<void>): void {
  browser.commands.onCommand.addListener((command) => {
    if (
      !['open-session-tree', 'open-settings', 'shortcutSnapshot'].includes(
        command,
      )
    )
      return
    void (async () => {
      if (command === 'open-settings') await browser.runtime.openOptionsPage()
      else {
        await ready
        if (command === 'open-session-tree') await Tree.openSessionTree()
        else if (await SessionSnapshots.capture('manual'))
          await notify(i18n.t('keyboardSnapshotCreated'))
      }
    })().catch((error) => {
      console.error('Keyboard command failed:', error)
      void notify(i18n.t('keyboardActionFailed'))
    })
  })
}
