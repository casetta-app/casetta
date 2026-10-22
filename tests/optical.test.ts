import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { normalizeBarcode, barcodeVariants } from '../src/scanner/codes.ts'
const require = createRequire(import.meta.url)
const {
  MultiFormatReader,
  RGBLuminanceSource,
  HybridBinarizer,
  BinaryBitmap,
  DecodeHintType,
  BarcodeFormat,
} = require('@zxing/library')
const samples = JSON.parse(
  readFileSync(
    new URL('./fixtures/barcodes/samples.json', import.meta.url),
    'utf8',
  ),
) as {
  name: string
  code: string
  valid: boolean
  bits: string
  width: number
  height: number
}[]
for (const sample of samples)
  test(`ZXing reale: campione ottico ${sample.name} ${sample.code}`, () => {
    const pixels = new Uint8ClampedArray(sample.width * sample.height)
    for (let y = 0; y < sample.height; y++)
      for (let x = 0; x < sample.width; x++)
        pixels[y * sample.width + x] =
          sample.bits[Math.floor(x / 3)] === '1' ? 0 : 255
    const reader = new MultiFormatReader()
    reader.setHints(
      new Map([
        [
          DecodeHintType.POSSIBLE_FORMATS,
          [
            BarcodeFormat.EAN_8,
            BarcodeFormat.EAN_13,
            BarcodeFormat.UPC_A,
            BarcodeFormat.ITF,
          ],
        ],
        [DecodeHintType.TRY_HARDER, true],
      ]),
    )
    let code: string | null = null
    try {
      code = normalizeBarcode(
        reader
          .decodeWithState(
            new BinaryBitmap(
              new HybridBinarizer(
                new RGBLuminanceSource(pixels, sample.width, sample.height),
              ),
            ),
          )
          .getText(),
      )
    } catch {
      /* Expected for blank and invalid checksum. */
    }
    if (sample.valid)
      assert.ok(
        code && barcodeVariants(sample.code).includes(code),
        `${sample.code} decoded as ${code}`,
      )
    else assert.equal(code, null)
  })
