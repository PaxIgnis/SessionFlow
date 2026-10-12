import { i18n, localizeDocument } from '@/services/i18n'
import '@/styles/variables.css'
import './style.css'
document.addEventListener('DOMContentLoaded', () => {
  initializeRedirectPage()
  const page = document.getElementById('redirect-page')
  if (page) page.hidden = false
})

function initializeRedirectPage() {
  localizeDocument()
  const params = new URLSearchParams(window.location.search)
  const targetUrl = params.get('targetUrl')
  const targetTitle = params.get('targetTitle')
  const messageElement = document.getElementById('message')
  const targetTitleElement = document.getElementById('target-title')
  const targetTitleSection = document.getElementById('target-title-section')
  const targetUrlElement = document.getElementById(
    'target-url',
  ) as HTMLAnchorElement | null
  const copiedMessageElement = document.getElementById('copied-message')
  const copyButton = document.getElementById(
    'copy-url',
  ) as HTMLButtonElement | null

  document.title = targetTitle
    ? i18n.t('redirectTo', [targetTitle])
    : i18n.t('redirectHeading')

  if (!targetUrl || !messageElement || !targetUrlElement) {
    return
  }

  targetUrlElement.textContent = targetUrl
  targetUrlElement.href = targetUrl
  if (targetTitle && targetTitleElement && targetTitleSection) {
    targetTitleElement.textContent = targetTitle
    targetTitleSection.hidden = false
  }
  messageElement.textContent = i18n.t(
    'theURLIsPrivilegedAndCannotBeOpenedAutomaticallyBecause',
  )
  if (copyButton) copyButton.disabled = false

  const copyUrl = async (event: Event) => {
    event.preventDefault()
    copiedMessageElement?.classList.remove('visible')
    copiedMessageElement?.classList.remove('error')
    const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard)
    if (!writeText) {
      showManualCopyMessage(copiedMessageElement)
      return
    }

    try {
      await writeText(targetUrl)
      if (!copiedMessageElement) return
      copiedMessageElement.textContent = i18n.t('copied')
      copiedMessageElement.classList.add('visible')
      setTimeout(() => {
        copiedMessageElement.classList.remove('visible')
      }, 2000)
    } catch (error) {
      console.error('Error copying URL to clipboard:', error)
      showManualCopyMessage(copiedMessageElement)
    }
  }

  targetUrlElement.addEventListener('click', copyUrl)
  copyButton?.addEventListener('click', copyUrl)
}

function showManualCopyMessage(element: HTMLElement | null): void {
  if (!element) return
  element.textContent = i18n.t('copyUnavailableSelectTheURLAndCopyItManually')
  element.classList.add('error')
  element.classList.add('visible')
}

export {}
