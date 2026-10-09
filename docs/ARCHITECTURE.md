# Architecture and debugging notes

## Page loading order

`index.html` loads `css/styles.css`, then `vendor/jszip.min.js`, then `js/app.js`. Keep JSZip before the app because the ZIP exporter reads the global `JSZip` constructor.

## Main files

- `index.html`: application markup, page sections, form controls, buttons, and status regions.
- `css/styles.css`: layout, responsive breakpoints, editor panels, controls, and visual states.
- `js/app.js`: application state, import and parsing helpers, scene rendering, UI handlers, config validation, OBJ generation, Web Worker source, and export routines.
- `vendor/jszip.min.js`: upstream JSZip distribution used to create ZIP files in the browser.

## Export path

1. Validation checks the model and configuration before export starts.
2. `buildPackageFiles()` assembles OBJ, texture, configuration, and supporting files.
3. `serializeOBJResponsive()` chooses a Worker for sufficiently large models when available and falls back to the normal serializer otherwise.
4. `exportZip()` adds package files to JSZip using compression settings from `zipProfile()` and begins the download.
5. `exportFolder()` writes the same package to a selected directory where the browser supports the File System Access API.

## Debugging

- Use a local server rather than `file://` when testing Worker or folder export behavior.
- Open DevTools → Console and Network. Look for a missing `vendor/jszip.min.js`, `js/app.js`, or `css/styles.css` request.
- If ZIP export fails, capture the status text, browser version, number of meshes/vertices, export mode, and compression mode.
- Test with a tiny known-good model first, then increase mesh count and texture size.
- Avoid sharing large/private meshes in public issues; provide a minimal sample you have permission to redistribute.

## Planned module boundaries

When extracting modules, keep the boundary explicit and testable:

- `model/`: model data structures and import parsers
- `viewport/`: WebGL rendering and camera interaction
- `config/`: configuration parsing, defaults, and validation
- `export/`: OBJ serialization, package assembly, ZIP and folder writers
- `ui/`: page navigation, controls, and status messages

A module refactor should preserve the current no-build-step workflow unless the maintainers agree to a build tool.
