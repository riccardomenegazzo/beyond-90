# The browser extension

Beyond 90 is also a browser extension for Chrome, Edge and other Chromium browsers (version 120 or later) and for Firefox (140 or later). It is the website, packaged: the same page, the same engine running in WebAssembly, the same data rules. The toolbar button opens it in a tab of its own.

## Install

The packages are built by the Pages workflow and offered from the app's Help page (`extension/beyond90-chrome.zip`, `extension/beyond90-firefox.zip`).

- **Chrome or Edge.** Unzip the file. Open `chrome://extensions` (or `edge://extensions`), turn on *Developer mode*, choose *Load unpacked* and pick the folder.
- **Firefox.** Open `about:debugging`, then *This Firefox*, *Load Temporary Add-on*, and pick the zip. A temporary add-on is removed when Firefox closes; a permanent install needs the package signed by Mozilla.

Listing in the Chrome Web Store and on addons.mozilla.org needs a developer account in the owner's name; the packages are ready for both (Manifest V3, no permissions, Mozilla's validator reports no errors).

## What it can and cannot do

| | The extension |
|---|---|
| Permissions | none: no tabs, no storage permission, no host access |
| Pages you visit | invisible to it: no content scripts, nothing injected |
| Network | none beyond its own files: `connect-src 'self'` for the page and the engine |
| Policy | the page's own Content Security Policy, set in the manifest and enforced by the browser on every extension page and worker; Trusted Types required |
| Background | one listener that opens the app in a tab on a toolbar click |
| Saved data | IndexedDB under the extension's private origin, which no website shares; the passphrase protection works as on the website |
| News | the feed collected when the package was built; the website refreshes it daily |

On the website the engine's worker starts from a `blob:` URL so that it inherits the page's policy. An extension's policy may not allow `blob:` workers and does not need them: the browser applies the manifest policy to the worker started from the extension's own `worker.js`. The Trusted Types policy that starts the engine accepts exactly that file and nothing else.

## Publishing in the stores

Both packages are ready for the stores; listing them needs the owner's developer accounts.

- **Chrome Web Store.** Upload `beyond90-chrome-<version>.zip`. Single purpose: "Opens Beyond 90, a customer-health workspace for cloud security teams, in a tab; all analysis runs locally." Permissions: none to justify. Remote code: none (WebAssembly is bundled). Data use: the extension collects and transmits no user data.
- **addons.mozilla.org.** Upload `beyond90-firefox-<version>.zip`; the manifest declares that no data is collected. Mozilla may ask for the source: it is this repository, and `site/build_extension.py` rebuilds the package byte for byte.

Each package is listed in the signed `SHA256SUMS` provenance of its Pages build, so the store copy can be matched to the source.

## Build and test

```bash
python site/build_site.py --out _site --pyodide site/npm/node_modules/pyodide
python site/build_extension.py --site _site --out dist/extension   # chrome/ and firefox/ folders, and a zip for each
python site/e2e_extension.py dist/extension/chrome                  # loads it in Chromium and runs the demo
```

The packages are reproducible (fixed order and timestamps) and leave out the service worker, which an extension does not need. The icons are drawn by the build script, so the package holds no binary that is not built from source. `tests/test_extension.py` pins the manifest: no permissions, the page's policy minus `blob:`, the right background for each browser.
