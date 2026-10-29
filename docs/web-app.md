# Running the session tree as a Firefox web app

Firefox can pin a page to the taskbar as a **web app**. It opens in its own window with its own taskbar entry and icon, separate from your other Firefox windows. Running the session tree this way keeps it one click away, like a standalone app.

Firefox does not yet let extensions create or recognize web app windows ([Bug 1991315](https://bugzilla.mozilla.org/show_bug.cgi?id=1991315)), so you set it up yourself and Session Flow supports it with a setting. See [issue #73](https://github.com/PaxIgnis/SessionFlow/issues/73) for background.

## Supported platforms

| Platform                         | Supported     | Notes                                                                                                                                                                  |
| -------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows                          | Firefox 143+  | Enabled by default. Microsoft Store installs need Firefox 150+.                                                                                                        |
| Linux (distro package / tarball) | Firefox 150+  | Disabled by default. Set `browser.taskbarTabs.enabled` to `true` in `about:config`. On GNOME, see [Bug 2021458](https://bugzilla.mozilla.org/show_bug.cgi?id=2021458). |
| Linux (Flatpak)                  | Firefox 153+  | Same preference as above.                                                                                                                                              |
| Linux (Snap)                     | Not supported | [Bug 2019115](https://bugzilla.mozilla.org/show_bug.cgi?id=2019115)                                                                                                    |
| macOS                            | Not supported | [Bug 1982734](https://bugzilla.mozilla.org/show_bug.cgi?id=1982734)                                                                                                    |

## Set up the web app

1. On Linux, open `about:config` and set `browser.taskbarTabs.enabled` to `true`.
2. Open Session Flow **Settings → General** and set `Hide the session tree window from the tree` to `Popup and Single Tab`. Firefox reports web app windows as normal windows, so this setting lets Session Flow recognize the tree's own window and keep it out of your tree.
3. In the same section, turn off `Open the session tree on startup`. Firefox does not reopen web apps at startup, so this setting would open the popup window instead.
4. Click **Open in Tab** beside **Open the session tree in a tab**.
5. In the new tab, click **Add tab to taskbar** at the right end of the address bar.

Firefox moves the tab into its own window with the Session Flow icon. On Windows the web app is also added to the Start menu, in the **Firefox Web Apps** folder. On Linux it appears in your application launcher.

On GNOME, the new window can briefly be associated with the wrong application. If its icon is wrong, wait until searching for **Session Flow** in GNOME finds the web app, then close the window and reopen it from there.

## Using the web app

Launch the session tree from its taskbar or Start menu entry. While the web app is open, the **Session Flow** toolbar button and **F2** bring it to the front. When it is closed, they open the regular popup window instead; Session Flow cannot launch the web app itself.

## Known limitations

- **Tabs opened in the web app window are not tracked.** With **Popup and Single Tab** selected, any window whose only tab is the session tree is treated as the session tree window. If you open more tabs in it, Session Flow ignores them until the window closes.
- **The toolbar makes the window wider than the popup.** Web app windows always show Firefox's toolbar, which sets a minimum window width. The optional [compact toolbar](#optional-compact-toolbar) removes this limit.
- **The taskbar icon is saved when the web app is created.** If you created the web app with an older Session Flow version and it shows a generic icon, remove it and create it again.
- **Reinstalling Session Flow breaks the web app.** The extension's internal address changes on reinstall. Remove the web app and create it again.

## Remove the web app

Click **Remove tab from taskbar** in the web app's address bar, or unpin it from the taskbar. If you use the compact toolbar, the address bar is hidden, so unpin it instead. Then set **Hide the session tree window from the tree** back to **Popup Only**.

## Optional: compact toolbar

Firefox's own styling can be changed with a `userChrome.css` file. The snippets below only affect the Session Flow web app window, not your other Firefox windows or other web apps.

The **base snippet** hides the address bar, toolbar buttons and the Firefox menu button, shows **Session Flow** as the window title, and lets the window become as narrow as the popup. The **auto-hide snippet** additionally hides the toolbar until you move the mouse to the top edge of the window. Use the base snippet on its own, or both together.

`userChrome.css` is an unsupported Firefox feature, and a Firefox update can break these snippets.

### Install

1. Open `about:config` and set `toolkit.legacyUserProfileCustomizations.stylesheets` to `true`.
2. Open `about:support`, find **Profile Folder**, and click **Open Folder**.
3. In the profile folder, create a folder named `chrome` if it does not exist.
4. In the `chrome` folder, create a file named `userChrome.css`, or open it if it already exists.
5. Paste the base snippet at the end of the file. For the auto-hide toolbar, paste the auto-hide snippet below it.
6. Save the file and restart Firefox.

To undo the changes, remove the snippets from `userChrome.css` and restart Firefox.

### Base snippet

```css
/* Session Flow web app: compact toolbar with window title */
:root[taskbartab]:has(.tabbrowser-tab[selected][label='Session Flow']) {
  min-width: 0 !important;

  & #nav-bar-customization-target {
    min-width: 0 !important;
  }
  & #nav-bar-customization-target > *,
  & #nav-bar .titlebar-spacer,
  & #PanelUI-button {
    display: none !important;
  }

  /* Window title in the empty toolbar space */
  & #nav-bar-customization-target::before {
    content: 'Session Flow';
    margin-block: auto;
    margin-inline-end: auto;
    padding-inline: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--toolbar-color, var(--lwt-text-color, CanvasText));
    font: menu;
  }
}
```

### Auto-hide snippet

The toolbar opens when the mouse reaches the top 8 pixels of the window, pushes the tree down while open, and hides 3 seconds after the mouse leaves. Adjust `--sf-hover-zone` and `--sf-hide-delay` to change this. While the toolbar is hidden, the top 8 pixels of the tree open the toolbar instead of reacting to clicks.

```css
/* Session Flow web app: auto-hide the toolbar */
:root[taskbartab]:has(.tabbrowser-tab[selected][label='Session Flow']) {
  --sf-hover-zone: 8px;
  --sf-hide-delay: 3s;

  /* The toolbar takes no space until hovered, then pushes the page down.
     A transparent bottom border, pulled over the page by a negative margin,
     is the invisible hover zone. */
  & #navigator-toolbox {
    position: relative !important;
    z-index: 2147483647 !important;
    background: var(
      --lwt-accent-color,
      var(--toolbox-bgcolor, Canvas)
    ) !important;
    background-clip: padding-box !important;
    border-bottom: var(--sf-hover-zone) solid transparent !important;
    margin-bottom: calc(-1 * var(--sf-hover-zone)) !important;
    max-height: var(--sf-hover-zone) !important;
    transition: max-height 150ms ease var(--sf-hide-delay) !important;
  }
  /* Open instantly so a brief hover can't leave it half open */
  & #navigator-toolbox:hover,
  & #navigator-toolbox:focus-within {
    max-height: 100px !important;
    transition: none !important;
  }
  /* Only the nav bar: the hidden tab strip relies on visibility: collapse */
  & #nav-bar {
    transition: visibility 0s linear var(--sf-hide-delay) !important;
  }
  & #navigator-toolbox:not(:hover, :focus-within) #nav-bar {
    visibility: hidden !important;
  }
  & #navigator-toolbox:hover #nav-bar,
  & #navigator-toolbox:focus-within #nav-bar {
    transition: none !important;
  }
  /* Drag areas swallow mouse events on Windows, so the hidden toolbar must not be one */
  & #navigator-toolbox:not(:hover, :focus-within),
  & #navigator-toolbox:not(:hover, :focus-within) * {
    -moz-window-dragging: no-drag !important;
  }
}
```
