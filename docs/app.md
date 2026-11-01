# The browser app

`site/` is a static web app: the same Python engine, running in the browser through [Pyodide](https://pyodide.org) (WebAssembly). It exists so a TAM can try Beyond 90 on a laptop with nothing installed, and so a hiring manager can open a link and see it work.

## What it does

Drop a customer folder (or pick the files), or press **Try the demo**, then **Run analysis**. You get the report, the QBR draft, the roadmap, the summary and the JSON, each with Copy and Download. Validation shows every problem at once, by file and line.

## What it does not do

- It does not upload anything. Files are read with the browser's File API and handed to Python in memory. The page has a Content Security Policy that allows requests to its own origin only (`connect-src 'self'`), so even a bug could not send your data elsewhere. Nothing is stored: close the tab and it is gone.
- It does not keep history (no SQLite in the page), and it does not run `book`, `radar` or `import`. Those need many folders or native exports and stay in the CLI.
- No third party is contacted. Pyodide (about 14 MB) is copied into the site at build time and served from the same origin; the first visit downloads it, later visits use the browser cache.

## Publish it on GitHub Pages

1. The repository must be allowed to use Pages. Public repositories can on every plan; **private repositories need a paid plan** (Pro, Team or Enterprise).
2. In *Settings, Pages*, set *Source* to **GitHub Actions**.
3. Push to `main` (or run the *Pages* workflow by hand). The workflow installs Pyodide, builds `_site/`, runs the browser smoke test (`site/e2e.py`) and deploys. The address is `https://<user>.github.io/beyond-90/`.

A Pages site from a public repository is public. Do not put customer data in the repository; the demo is a made-up customer.

## Build and test locally

```bash
npm install pyodide@314.0.7 --prefix build/npm
python site/build_site.py --out _site --pyodide build/npm/node_modules/pyodide
python -m http.server --directory _site 8000          # then open http://localhost:8000
pip install playwright && python -m playwright install chromium
python site/e2e.py _site
```

`file://` does not work: browsers do not let a page load WebAssembly from disk. Serve the folder.

## Design notes

- `beyond90.web.analyze_json` is the only function the page calls; `tests/test_web.py` checks it returns the same Yield as the CLI.
- The Markdown viewer escapes everything before it adds markup, and the report is shown in a sandboxed iframe with no scripts.
- The same palette and light and dark themes as the report; no vendor assets.
