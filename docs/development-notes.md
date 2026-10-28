# Workflow notes

- Continue releases from current staging; the original workspace has an older app baseline.
- Validate typecheck, tests, and build; update docs/menu-assistant.md and README together.
- Agent actions must use real restaurant IDs. Keep extracted source evidence separate from generated prose.
- Deploy via a feature PR into staging; verify the Pages run and published bundle.

- Pin matching ONNX Runtime JS/WASM and version their asset URLs; verify repeated browser GPU turns and a longer prompt before release.
- Mobile GPU failures: record export, inference stage, device loss and validation before changing weights/runtime; desktop success does not validate the Fold.
