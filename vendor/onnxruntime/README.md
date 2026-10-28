# Staging WebGPU runtime trial

Official, unmodified ONNX Runtime packages from [Web CI run 40642053504](https://github.com/microsoft/onnxruntime/actions/runs/40642053504), artifact `NPM_packages` (12800726471).

- Source: `c026a50999772f94d6f48d07df5964465c721131`, an ancestor-verified descendant of callback-lifetime fix `e379df24dbe4` ([#33209](https://github.com/microsoft/onnxruntime/pull/33209)).
- Version: `1.32.0-dev.20261028-c026a50`; experimental CI build, not a stable release. Pin both packages so JS and WASM stay matched. Files are committed because CI artifacts expire and npm's dev tag predates the fix.
- SHA-256, common: `48cbea408d157a65a302a1c35068edcf17edd3aeab67845d573ac797a88aceb1`.
- SHA-256, web: `62bfba09728226ba8c57df427e261340843ccabbd4012ae638f7992479edf7a3`.
- Upstream MIT license is preserved in LICENSE. Never replace only the WASM binary.

Staging only: retain the 273 MB q4f16 mobile weights and local GPU diagnostics. A successful desktop test does not establish Fold compatibility.

The native-provider trial still lost the Fold Adreno device during readiness. The next staging trial aliases the runtime import to the official all bundle (JSEP WebGPU) and ships its matching jsep assets. GPU selection, model export, and package archives stay unchanged.
