import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeBarcode,
  barcodeVariants,
  cameraError,
} from '../src/scanner/codes.ts'

test('barcode: checksum, lunghezze e zeri iniziali restano stringhe', () => {
  for (const code of [
    '96385074',
    '036000291452',
    '4006381333931',
    '10012345000017',
  ])
    assert.equal(normalizeBarcode(` ${code} `), code)
  for (const code of [
    '123',
    '4006381333932',
    '4006381x33931',
    '4006 381333931',
  ])
    assert.equal(normalizeBarcode(code), null)
})
test('UPC e EAN con zero iniziale cercano entrambi senza perdere il valore originale', () => {
  assert.deepEqual(barcodeVariants('036000291452'), [
    '036000291452',
    '0036000291452',
  ])
  assert.deepEqual(barcodeVariants('0036000291452'), [
    '0036000291452',
    '036000291452',
  ])
  assert.deepEqual(barcodeVariants('96385074'), ['96385074'])
})
test('permessi negati e fotocamera assente offrono sempre la via manuale', () => {
  const denied = new Error()
  denied.name = 'NotAllowedError'
  assert.match(cameraError(denied), /negato/)
  const absent = new Error()
  absent.name = 'NotFoundError'
  assert.match(cameraError(absent), /mano/)
})
