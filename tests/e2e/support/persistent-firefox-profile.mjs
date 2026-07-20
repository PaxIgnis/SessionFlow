import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function createPersistentFirefoxProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sessionflow-e2e-profile-'))
}

export function removePersistentFirefoxProfile(profilePath) {
  fs.rmSync(profilePath, { recursive: true, force: true })
}
