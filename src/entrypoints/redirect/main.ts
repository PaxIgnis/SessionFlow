document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search)
  const targetUrl = params.get('targetUrl')
  const targetTitle = params.get('targetTitle')
  const messageElement = document.getElementById('message')
  const targetUrlElement = document.getElementById(
    'target-url',
  ) as HTMLAnchorElement | null
  const copiedMessageElement = document.getElementById('copied-message')

  if (targetTitle) {
    document.title = `Redirect to ${targetTitle}`
  }

  if (!targetUrl || !messageElement || !targetUrlElement) {
    return
  }

  targetUrlElement.textContent = targetUrl
  targetUrlElement.href = targetUrl
  messageElement.textContent =
    'The URL is privileged and cannot be opened automatically because of Firefox security restrictions. Select the URL to copy it, then paste it into the address bar.'
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
          copiedMessageElement.textContent = 'Copied!'
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
  element.textContent = 'Copy unavailable. Select the URL and copy it manually.'
  element.classList.add('visible')
}

export {}
