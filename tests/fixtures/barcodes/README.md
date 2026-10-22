# Optical regression samples

`generate.cjs` creates static SVGs and `samples.json` using EAN digit/parity/guard tables and ITF narrow/wide interleaving, independently of ZXing. Each SVG includes human-readable digits, quiet zones and black bars on white. Regenerate with `node tests/fixtures/barcodes/generate.cjs`.

Valid samples: EAN-13 `9771125522005`, EAN-8 `96385074`, UPC-A `036000291452` (encoded as equivalent EAN-13 with leading zero), ITF-14 `10012345000017`. The negative EAN sample encodes `9771125522006` unchanged, deliberately with an incorrect checksum; `blank.svg` contains no bars. The production checksum validation is unchanged.

`pnpm test` decodes rasterized sample rows with the real ZXing library. With Vite at localhost:5173, `node tests/optical-browser.cjs` (Playwright/Chromium required) loads the actual SVG images through the browser canvas and the production frame decoder. It also runs the production camera loop on `canvas.captureStream`: no simulated decoder callback. Native API availability/failure is simulated in the partial/native-error cases; the ZXing fallback is real.

These are ideal generated optical samples. They do not reproduce curved packaging, glare, motion blur, physical focus or Safari camera hardware. They prove image decoding and pipeline integration, not an iPhone field test.
