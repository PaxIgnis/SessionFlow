import { isPrivateWindowAccessAllowed } from '@/services/utils'

type CompletionCommand = 'continue' | 'dismiss'

let completionPending = false

document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('private-access-status')
  const checkAgain = document.getElementById('check-again')
  const continueButton = document.getElementById('continue')
  const hideButton = document.getElementById('hide')
  const dismissButton = document.getElementById('dismiss')
  if (
    !status ||
    !checkAgain ||
    !continueButton ||
    !hideButton ||
    !dismissButton
  ) {
    return
  }

  checkAgain.addEventListener('click', () => refreshAccessStatus(status))
  continueButton.addEventListener('click', () => completeOnboarding('continue'))
  hideButton.addEventListener('click', () => window.close())
  dismissButton.addEventListener('click', () => completeOnboarding('dismiss'))

  await refreshAccessStatus(status)
})

async function refreshAccessStatus(status: HTMLElement): Promise<void> {
  status.textContent = 'Checking…'
  status.dataset.status = 'checking'

  const allowed = await isPrivateWindowAccessAllowed()
  status.textContent = allowed ? 'Allowed' : 'Not allowed'
  status.dataset.status = allowed ? 'allowed' : 'not-allowed'
}

async function completeOnboarding(command: CompletionCommand): Promise<void> {
  if (completionPending) return
  completionPending = true

  try {
    await browser.runtime.sendMessage({
      action: 'privateWindowOnboarding',
      command,
    })
    window.close()
  } catch (error) {
    completionPending = false
    console.error('Failed to complete private-window onboarding:', error)
  }
}

export {}
