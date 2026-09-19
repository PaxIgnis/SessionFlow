# Exporting and importing snapshots

You can bring saved tabs and sessions from other programs into Session Flow using **Import snapshot** in **Settings → Storage**.

## Supported formats

| Program             | Supported file                | Instructions                                            |
| ------------------- | ----------------------------- | ------------------------------------------------------- |
| Session Flow        | JSON snapshot or session tree | [Export from Session Flow](#session-flow)               |
| Tabs Outliner       | JSON tree dump                | [Tabs Outliner Tree Dump](#tabs-outliner)               |
| Session Buddy       | JSON collection export        | [Export from Session Buddy](#session-buddy)             |
| Tab Session Manager | JSON session export           | [Export from Tab Session Manager](#tab-session-manager) |

Only the JSON formats listed above are supported. See the program sections below for limitations affecting older exports.

## Import into Session Flow

1. Export a JSON file using the instructions for your program below.
2. Open Session Flow **Settings → Storage**.
3. Click **Import snapshot** beside **Take a snapshot now**.
4. Select the JSON file.

The file becomes one snapshot in the history list, even if it contains several sessions. Imported snapshots receive an imported indicator and are protected automatically, so automatic cleanup will not remove them.

Importing does not open tabs or change your active session tree. Select the snapshot to preview its contents and review any conversion details. Use **Restore everything**, or select individual items and restore those, when you want to add them to your tree.

## Session Flow

1. Open **Settings → Storage**.
2. Select an existing snapshot, or click **Take a snapshot now** first.
3. Click **Save as JSON** in the snapshot preview.
4. Import the downloaded file in the other Session Flow installation.

Existing JSON session-tree exports can also be imported.

## Tabs Outliner

Session Flow currently accepts JSON tree dumps. If you already have one of these files, select it with **Import snapshot**.

Tabs Outliner's backups, HTML and text exports are different formats and cannot be imported yet as snapshots.

### Export using the developer console

1. Open the Tabs Outliner window in Chrome and leave it open.
2. Right-click the Tabs Outliner extension icon and choose **Manage extension**.
3. Under **Inspect views**, click **activesessionview.html** to open developer tools for the Tabs Outliner window.
4. Select the **Console** tab.
5. Paste the script below into the console and press **Enter**. It downloads a file named `tabsoutliner-backup.json`.

Use the console opened through **activesessionview.html**, so the script can read Tabs Outliner's saved tree.

```javascript
;(async () => {
  const request = indexedDB.open('TabsOutlinerDB34')

  const db = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  for (const storeName of db.objectStoreNames) {
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).get('currentSessionSnapshot')

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    if (value !== undefined) {
      const json =
        typeof value === 'string' ? value : JSON.stringify(value, null, 2)

      const blob = new Blob([json], {
        type: 'application/json',
      })

      const url = URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = url
      a.download = 'tabsoutliner-backup.json'

      document.body.appendChild(a)
      a.click()
      a.remove()

      setTimeout(() => URL.revokeObjectURL(url), 10000)

      console.log('JSON backup downloaded successfully!')
      console.log('Size:', json.length, 'characters')

      db.close()
      return
    }
  }

  db.close()
  console.error('currentSessionSnapshot not found')
})()
```

After saving the JSON file, select it with **Import snapshot** in Session Flow.

During import:

- Nested windows become separate saved windows immediately below their containing window.
- Groups become note branches.
- Conversion details identify anything that could not be preserved.

## Session Buddy

1. Open Session Buddy and choose **Export…** from the gear menu.
2. Choose the collections you want to export.
3. Select **JSON** as the format.
4. Click **Select destination** or **Download**, depending on your browser, to save the file.
5. Import that file in Session Flow.

Use a collection export for migration. Session Buddy history is not imported. Collections become named note branches containing saved windows.

Some older session-based JSON exports are accepted, but older date representations are not supported yet. If an older file fails, try opening it in the current Session Buddy and exporting its collections again.

See [Session Buddy's export instructions](https://sessionbuddy.com/import-export/#exporting-collections) for more details.

## Tab Session Manager

1. Open Tab Session Manager **Settings**.
2. Select **Sessions**.
3. Find **Export Sessions** and click **Export** to save your sessions as JSON.
4. Import that file in Session Flow.

Each session becomes a named note branch. Session Flow preserves tags as notes, saved windows, tab order and parent links, pinned tabs, and available tab-group details. Container assignments cannot be transferred from these exports; conversion details report affected tabs.

Use an export from a current version of Tab Session Manager. Older exports with legacy tag or date formats are not supported yet; open and re-export them in a current version first.
