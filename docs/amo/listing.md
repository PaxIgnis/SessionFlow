# Firefox Add-ons listing

The text and images for the [Session Flow listing on Firefox Add-ons](https://addons.mozilla.org/firefox/addon/session-flow/).

## Summary

Shown under the name on the listing and in search results. 250 characters maximum.

```
A vertical tree session manager for your windows and tabs, with saved sessions, notes, and separators and support for tab groups, containers, session import/exporting and more.

```

## Description

```
Your Firefox windows and tabs, organized in one tree.

Session Flow is a free, open-source Firefox extension that brings your open tabs and saved sessions together in a dedicated window. Nest related pages, group windows under notes, and set work aside without keeping every tab open.

**Features**

- Arrange windows and tabs into collapsible branches with drag and drop.
- Save individual tabs or entire windows, closing them in Firefox while keeping their place in your tree.
- Add notes, meaningful window & tab names, and separators.
- Take snapshots manually or automatically. Preview and restore a complete session or selected items.
- Back up your tree, snapshots, and settings to a file, manually or automatically on a schedule to your download folder.
- Import from Session Buddy, Tab Session Manager, Simple Tab Groups, OneTab, Tab Stash, and Tabs Outliner, or export snapshots as JSON.
- Unload tabs to free memory while keeping them open.
- Work with Firefox containers and tab groups.
- Customize keyboard shortcuts, tree actions, and startup behavior.
- Pin the tree to your taskbar as a Firefox web app on Windows and Linux (manual setup).

**Getting started**

Click the Session Flow toolbar button or press F2 to open your tree. An onboarding guide introduces the main features after installation.

**Privacy**

Your session tree, settings, snapshots, and favicon cache are stored locally in your Firefox profile. Backups are saved only where you choose on your computer. Session Flow has no analytics or tracking and does not send your browsing data to its developer.

Website icons may be retrieved from websites and their icon hosts. Fetching missing icons and refreshing cached icons require optional website access.

Permissions:

- Tabs and sessions
    - Required to: Track, organize, and restore browser windows and tabs.
- Containers and cookies
    - Required to: Read and manage Firefox container identities for tabs.
- Tab groups
    - Required to: Read and manage Firefox tab-group membership and metadata.
- Menus
    - Required to: Provide context-menu actions for tree items.
- Storage and unlimited storage
    - Required to: Keep your saved tree, settings, and favicon cache locally.
- Alarms
    - Required to: Schedule automatic snapshots and maintenance.
- Website access (optional)
    - Required to: Fetch missing favicons or refresh cached icons.
- Clipboard access (optional)
    - Required to: Copy snapshot JSON or a window's URLs to the clipboard when you request it.
- Downloads (optional)
    - Required to: Save automatic backups to a folder in your download folder.

**Compatibility**

Requires Firefox 140 or later on desktop.

Disable other extensions that automatically manage, restore, move, close, or unload tabs and windows, as overlapping behavior can cause unexpected issues.

**Support**

For questions, bug reports, and suggestions, visit:
https://github.com/PaxIgnis/SessionFlow/discussions

```

## Screenshots

Images live in [`images/`](images/). Keep each caption identical to the one entered on AMO.

| File                   | Caption                                                       |
| ---------------------- | ------------------------------------------------------------- |
| session-tree.png       | Keep your active research organized.                          |
| session-tree-saved.png | Set work and reading aside for later.                         |
| session-snapshots.png  | Preview a snapshot, restore your session, or export a backup. |

### Onboarding

The introduction that opens after installation: a welcome page, 17 feature tips with interactive examples, private window access, and a final setup step.

| File                                 | Caption                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| onboarding-1-welcome.png             | A short introduction opens after installation, with a sample tree to explore.                     |
| onboarding-2-tip-01-states.png       | The dot and text color show whether a tab is live, unloaded, or saved.                            |
| onboarding-2-tip-02-open.png         | Double-click a saved tab to open it in Firefox again.                                             |
| onboarding-2-tip-03-focus.png        | Double-click a live tab to switch to it in Firefox.                                               |
| onboarding-2-tip-04-close.png        | Delete a tab or window to close it and remove it from the tree.                                   |
| onboarding-2-tip-05-save.png         | Save a tab or window to close it in Firefox while keeping it in the tree.                         |
| onboarding-2-tip-06-organize.png     | Drag items onto each other to nest them, and collapse branches to keep the tree tidy.             |
| onboarding-2-tip-07-multi-select.png | Select several items with Ctrl or Shift and move or act on them together.                         |
| onboarding-2-tip-08-labels.png       | Label tabs and rename windows without changing the page itself.                                   |
| onboarding-2-tip-09-note-add.png     | Add notes beside your tabs or outside windows.                                                    |
| onboarding-2-tip-10-note-edit.png    | Double-click a note to edit its text.                                                             |
| onboarding-2-tip-11-note-group.png   | Group windows under a note by project or topic.                                                   |
| onboarding-2-tip-12-window-bar.png   | The window bar shows at a glance how many tabs are live, unloaded, or saved.                      |
| onboarding-2-tip-13-tab-groups.png   | Firefox tab groups appear as colored marks on grouped tabs.                                       |
| onboarding-2-tip-14-containers.png   | Container tabs show their color and icon, and you can change a tab's container from the tree.     |
| onboarding-2-tip-15-keyboard.png     | Navigate and organize the tree from the keyboard.                                                 |
| onboarding-2-tip-16-web-app.png      | Pin the tree to your taskbar as a Firefox web app on Windows and Linux.                           |
| onboarding-2-tip-17-private.png      | Private windows are clearly marked and kept separate from regular ones.                           |
| onboarding-3-private-windows.png     | Private window access is optional, and keeping private browsing information is a separate choice. |
| onboarding-4-finish.png              | Start with your current session or import one from another session manager.                       |

### Settings

| File                          | Caption                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| settings-01-general.png       | Choose how the tree opens and how your session is restored at startup.                    |
| settings-02-context-menu.png  | Decide when right-click actions also apply to child items you did not select.             |
| settings-03-windows.png       | Control how windows open, where they reopen, and when closed windows are saved.           |
| settings-04-tabs.png          | Choose what double-clicking a tab does and when closed tabs are saved.                    |
| settings-05-containers.png    | Adjust how container colors and icons appear in the tree.                                 |
| settings-06-tab-groups.png    | Choose how tab groups are shown and how dropped tabs join a group.                        |
| settings-07-drag-and-drop.png | Configure how drag and drop moves items and their children.                               |
| settings-08-favicons.png      | Control how website icons are fetched and cached.                                         |
| settings-09-keyboard.png      | Customize keyboard shortcuts for opening the tree and acting on items.                    |
| settings-10-snapshots.png     | Schedule automatic snapshots and decide how many older ones to keep.                      |
| settings-11-backup.png        | Back up your tree, snapshots, and settings to a file, or automatically to your downloads. |
| settings-12-storage.png       | See how much space the tree, snapshots, favicon cache, and settings use.                  |
