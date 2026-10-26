# Cloudborne Desktop contributor notes

## Verification commands

Run from this directory:

```sh
npm install
npm run build
npm test -- --run
cargo test --manifest-path src-tauri/Cargo.toml
```

Use `CLOUDBORNE_HOME=<directory>` for isolated configuration tests; do not touch a developer's real tool configuration in tests.

## Project boundaries

- React/Tailwind UI lives in `src/`; Tauri/Rust integration lives in `src-tauri/src/`.
- Tool detection and configuration adapters are under `src-tauri/src/tools/`; preserve backup and atomic-write behavior when changing them.
- Windows ZCode detection must not assume `C:` or `%LOCALAPPDATA%`; keep per-user/machine 32/64-bit registry and App Paths fallbacks covered by tests.
- Keep credentials, updater private keys, and machine-specific configuration out of source, docs, and commits.
- Windows WebView2 draws native `<select>` popups from the element's own colors, so translucent dark-mode fills become unreadable there while macOS looks fine. Give new selects `className="field"` so the opaque option colors in `src/index.css` apply.
- Scope DDZ state classes with `ddz-`; the chat `.turn` class changes layout spacing. Keep avatar/status slots stable across turns and fit the game to the actual pane width and height.
- Browser simulation and release checks do not establish native Tauri live-game acceptance. DDZ behavior, evidence and rollback boundaries live in [the DDZ document](docs/DOUDIZHU-IMPROVEMENT-2026-10-15.md).

## Release checklist

Keep the version synchronized in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. Run the verification commands before tagging `v*`; CI builds the macOS and Windows installers and publishes updater metadata through the GitHub Release workflow.
