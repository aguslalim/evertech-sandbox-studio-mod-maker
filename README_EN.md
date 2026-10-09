# Evertech Mod Studio

**Browser-based prototype for preparing 3D assets and export packages for Evertech Sandbox (EVTS) mods.**

Evertech Mod Studio is a client-side project: it runs in the browser and does not require an account or upload models to a server. This repository contains the multi-file development version of the v0.7 prototype.

> **Project status: experimental.** Treat exports as drafts. Check `info.json`, mesh paths, textures, colliders, and the resulting package, then test it in the target Evertech Sandbox version. This project is not affiliated with or endorsed by the Evertech Sandbox developers.

## Current capabilities

- Import supported model assets and inspect meshes in a browser-based 3D workspace.
- Manage meshes through an Outliner and edit object transforms.
- Configure per-item materials and collider metadata.
- Edit and validate the mod configuration JSON.
- Export separate or combined OBJ meshes, package assets, and create a ZIP archive.
- Choose Fast, Balanced, or Smaller ZIP compression modes.
- Show export progress; use a Web Worker for sufficiently large OBJ serialization when the browser supports it, with a fallback path.
- Export a folder in browsers that support the File System Access API (typically over `localhost` or HTTPS).

Feature availability and model-format support can vary by browser. OBJ is a static mesh format; animation and rigging are not preserved by OBJ export.

## Run locally

No build step or npm dependencies are required for normal use. A local HTTP server is recommended, especially for browser APIs such as Web Workers and folder export.

### Python

From the repository root:

```bash
python -m http.server 8080
```

Open <http://localhost:8080>.

### Node.js

With Node.js installed, you can also use:

```bash
npx serve .
```

Then open the local URL printed by the server.

You may open `index.html` directly for basic inspection, but browsers restrict some APIs on `file://`; use a local server when testing imports and exports.

## Repository layout

```text
EvertechModStudio/
├── index.html                  # App structure and accessible UI markup
├── css/
│   └── styles.css              # All application styles
├── js/
│   └── app.js                  # Application logic and event handlers
├── vendor/
│   └── jszip.min.js            # Vendored JSZip 3.10.1 for ZIP generation
├── scripts/
│   └── check-project.mjs       # Dependency-free static/syntax checks
├── docs/
│   └── ARCHITECTURE.md         # Code map and debugging notes
├── .github/
│   ├── ISSUE_TEMPLATE/         # Bug and feature request forms
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/              # GitHub Actions quality checks
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── NOTICE.md
├── LICENSE
└── package.json
```

### Why is application logic still in one JavaScript file?

This first repository split separates HTML, CSS, third-party code, and application code without changing the app's internal execution model. That keeps the prototype easier to run and reduces the risk of breaking shared state during the initial open-source release. The next refactor can extract well-defined areas (model parsers, viewport renderer, configuration, and exporters) into modules with tests.

## Development and checks

Use Node.js 18 or newer for the repository check script. The app itself has no Node runtime requirement once served in a browser.

```bash
npm test
```

The check script validates required project files/references and parses the JavaScript for syntax errors. It does **not** replace browser testing or confirm that every export is accepted by the game.

For manual testing, check at least:

1. Open the app in a desktop browser and on a narrow/mobile viewport.
2. Import a small supported model; inspect mesh names and transforms.
3. Edit configuration and run validation.
4. Export a ZIP in Fast mode, extract it, and inspect the OBJ and `info.json` paths.
5. Try Balanced and Smaller ZIP with a copy of the same project; compare time and file size.
6. Test the exported mod in the intended game version before reporting compatibility.

## Reporting bugs

Please include browser/OS versions, steps to reproduce, expected and actual results, the smallest sample asset that demonstrates the problem (only share assets you have permission to distribute), and any console error text. Never attach passwords, tokens, or private project assets.

## License

Application code in this repository is released under the MIT License. Third-party code and its notices are documented in [NOTICE.md](NOTICE.md); their respective licenses remain applicable.
