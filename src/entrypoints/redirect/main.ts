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
  messageElement.innerHTML = `
    The URL is a privileged URL and cannot be opened 
    automatically due to Firefox security restrictions. <br>
    Click the URL to copy it to the clipboard and paste 
    it into the URL bar yourself.`
  targetUrlElement.addEventListener('click', (event) => {
    event.preventDefault()
    navigator.clipboard
      .writeText(targetUrl)
      .then(() => {
        copiedMessageElement?.classList.add('visible')
        setTimeout(() => {
          copiedMessageElement?.classList.remove('visible')
        }, 2000)
      })
      .catch((error) => {
        console.error('Error copying URL to clipboard:', error)
      })
  })
})

export {}
