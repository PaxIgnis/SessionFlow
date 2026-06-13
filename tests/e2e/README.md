# WebdriverIO Firefox E2E

This is the active Firefox UI E2E path for SessionFlow.

Run:

- `pnpm run test:e2e`

This command runs Firefox headed by default because the workflow tests depend on
Firefox extension window events that are unreliable in headless mode. To opt
into the unstable headless path for diagnostics, set `WDIO_HEADLESS=true`.

The WDIO suite packages the Firefox extension with `pnpm run zip:firefox`, starts Firefox through geckodriver, installs the generated XPI as a temporary add-on with `browser.installAddOn(..., true)`, and opens `sessiontree.html` through a deterministic `moz-extension://` URL.

The first smoke test verifies that the extension page loads and the SessionTree Vue root exists. Workflow specs seed local `data:text/html` tabs so background snapshots and browser tab events are deterministic and network-free.

The context-menu workflow captures `browser.menus.create` inside the extension page and invokes the captured SessionFlow command handler. This validates the extension menu-command path; it does not assert native Firefox context-menu rendering.
