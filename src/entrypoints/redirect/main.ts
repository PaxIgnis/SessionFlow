import { localizeDocument } from '@/services/i18n'
import { i18n } from '@/services/i18n'
document.addEventListener('DOMContentLoaded', () => {
  localizeDocument()
  const params = new URLSearchParams(window.location.search)
  const targetUrl = params.get('targetUrl')
  const targetTitle = params.get('targetTitle')
  const messageElement = document.getElementById('message')
  const targetUrlElement = document.getElementById(
    'target-url',
  ) as HTMLAnchorElement | null
  const copiedMessageElement = document.getElementById('copied-message')

  if (targetTitle) {
    document.title = i18n.t('redirectTo', [targetTitle])
  }

  if (!targetUrl || !messageElement || !targetUrlElement) {
    return
  }

  targetUrlElement.textContent = targetUrl
  targetUrlElement.href = targetUrl
  messageElement.textContent = i18n.t(
    'theURLIsPrivilegedAndCannotBeOpenedAutomaticallyBecause',
  )
  targetUrlElement.addEventListener('click', (event) => {
    event.preventDefault()
    const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard)
    if (!writeText) {
      showManualCopyMessage(copiedMessageElement)
      return
    }

    try {
      void writeText(targetUrl)
        .then(() => {
          if (!copiedMessageElement) return
          copiedMessageElement.textContent = i18n.t('copied')
          copiedMessageElement.classList.add('visible')
          setTimeout(() => {
            copiedMessageElement.classList.remove('visible')
          }, 2000)
        })
        .catch((error) => {
          console.error('Error copying URL to clipboard:', error)
          showManualCopyMessage(copiedMessageElement)
        })
    } catch (error) {
      console.error('Error copying URL to clipboard:', error)
      showManualCopyMessage(copiedMessageElement)
    }
  })
})

function showManualCopyMessage(element: HTMLElement | null): void {
  if (!element) return
  element.textContent = i18n.t('copyUnavailableSelectTheURLAndCopyItManually')
  element.classList.add('visible')
}

export {}
