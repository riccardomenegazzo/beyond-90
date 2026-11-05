# Third-party software

Beyond 90 itself is Apache-2.0 (see `LICENSE`) and the Python package has **no runtime dependencies**.

The browser app published to GitHub Pages bundles, unmodified and served from the same origin:

| Component | Licence | Source |
|---|---|---|
| Pyodide (the Python runtime compiled to WebAssembly; build copied from the npm package `pyodide`) | MPL-2.0 | https://github.com/pyodide/pyodide |
| CPython and its standard library, inside Pyodide | PSF-2.0 | https://www.python.org |
| Emscripten runtime pieces, inside Pyodide | MIT / UIUC | https://emscripten.org |
| Atkinson Hyperlegible Next, the typeface (variable, Latin and Latin Extended; from the npm package `@fontsource-variable/atkinson-hyperlegible-next`) | OFL-1.1 (licence copied to `fonts/OFL.txt`) | https://www.brailleinstitute.org/freefont/ |

Pyodide's own files are not modified, so the Mozilla Public License obligations are met by this notice and by the source being available at the address above. The exact version is pinned in `.github/workflows/pages.yml`.

Development-only tools (not shipped): pytest, ruff, mypy, Playwright, axe-core (MPL-2.0).
