import { browser } from '@wdio/globals'

export function sendSnapshotRequest(request) {
  return browser.executeAsync((message, done) => {
    window.browser.runtime
      .sendMessage(message)
      .then(done)
      .catch((error) => done({ ok: false, error: String(error) }))
  }, request)
}

export function readPersistedSessionTree() {
  return browser.executeAsync((done) => {
    window.browser.storage.local
      .get('sessionTree')
      .then(({ sessionTree }) => done(sessionTree || []))
      .catch((error) => done({ error: String(error) }))
  })
}

export function readSnapshotAlarm() {
  return browser.executeAsync((done) => {
    window.browser.alarms
      .get('session-flow-periodic-snapshot')
      .then((alarm) => done(alarm || null))
      .catch((error) => done({ error: String(error) }))
  })
}
