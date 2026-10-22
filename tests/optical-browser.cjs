const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const samples = require('./fixtures/barcodes/samples.json')
;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    })
    await page.goto('http://127.0.0.1:5173/casetta/')
    const results = await page.evaluate(async (samples) => {
      const { createFrameDecoder } =
        await import('/casetta/src/scanner/decoder.ts')
      const { normalizeBarcode } = await import('/casetta/src/scanner/codes.ts')
      const decode = await createFrameDecoder()
      const output = []
      for (const sample of samples) {
        const image = new Image()
        image.src = `/casetta/tests/fixtures/barcodes/${sample.name}.svg`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        canvas.getContext('2d').drawImage(image, 0, 0)
        const value = decode(canvas)
        output.push({
          name: sample.name,
          code: value && normalizeBarcode(value),
        })
      }
      // Integration: real captured frames from a sample canvas through the production camera loop.
      const img = new Image()
      img.src = '/casetta/tests/fixtures/barcodes/ean13.svg'
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      const stream = canvas.captureStream(10)
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => stream },
      })
      Object.defineProperty(window, 'BarcodeDetector', {
        configurable: true,
        value: undefined,
      })
      const video = document.createElement('video')
      document.body.append(video)
      const { startBarcodeCamera } =
        await import('/casetta/src/scanner/camera.ts')
      const captured = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          stop()
          reject(Error('Real decoder camera loop timeout'))
        }, 15000)
        const stop = startBarcodeCamera(
          video,
          (code) => {
            clearTimeout(timeout)
            stop()
            resolve(code)
          },
          reject,
          () => {},
        )
      })
      const partial = []
      for (const mode of ['partial', 'native-error']) {
        const sampleImage = new Image()
        sampleImage.src = '/casetta/tests/fixtures/barcodes/itf14.svg'
        await sampleImage.decode()
        canvas.width = sampleImage.naturalWidth
        canvas.height = sampleImage.naturalHeight
        canvas.getContext('2d').drawImage(sampleImage, 0, 0)
        const secondStream = canvas.captureStream(10)
        navigator.mediaDevices.getUserMedia = async () => secondStream
        let nativeCalls = 0
        let nativeFormats = []
        window.BarcodeDetector = class {
          static async getSupportedFormats() {
            return ['ean_8', 'ean_13', 'upc_a']
          }
          constructor(options) {
            nativeFormats = options.formats
          }
          async detect() {
            nativeCalls++
            if (mode === 'native-error') throw Error('native failure')
            return []
          }
        }
        const value = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            stop()
            reject(Error('ITF fallback timeout'))
          }, 15000)
          const stop = startBarcodeCamera(
            video,
            (code) => {
              clearTimeout(timeout)
              stop()
              resolve(code)
            },
            reject,
            () => {},
          )
        })
        partial.push({
          value,
          nativeCalls,
          nativeFormats,
          stopped: secondStream
            .getTracks()
            .every((t) => t.readyState === 'ended'),
        })
      }
      window.BarcodeDetector = undefined
      const brokenStream = canvas.captureStream(10)
      navigator.mediaDevices.getUserMedia = async () => brokenStream
      const originalDraw = CanvasRenderingContext2D.prototype.drawImage
      const pump = setInterval(
        () => originalDraw.call(canvas.getContext('2d'), img, 0, 0),
        50,
      )
      CanvasRenderingContext2D.prototype.drawImage = () => {
        throw Error('broken frame')
      }
      const fatal = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          stop()
          reject(Error('Decoder failure was silent'))
        }, 15000)
        const stop = startBarcodeCamera(
          video,
          () => reject(Error('Unexpected code')),
          (error) => {
            clearTimeout(timeout)
            resolve({ name: error.name, message: error.message })
          },
          () => {},
        )
      })
      clearInterval(pump)
      CanvasRenderingContext2D.prototype.drawImage = originalDraw
      return {
        fatal,
        fatalStopped: brokenStream
          .getTracks()
          .every((track) => track.readyState === 'ended'),
        partial,
        output,
        captured,
        stopped: stream
          .getTracks()
          .every((track) => track.readyState === 'ended'),
      }
    }, samples)
    for (const sample of samples) {
      const result = results.output.find((r) => r.name === sample.name)
      if (sample.valid)
        assert.ok(
          result.code === sample.code ||
            (sample.code.length === 12 && result.code === '0' + sample.code),
          JSON.stringify(result),
        )
      else assert.equal(result.code, null)
    }
    assert.equal(results.captured, '9771125522005')
    assert.equal(results.stopped, true)
    assert.match(
      results.fatal.message,
      /broken frame|Decoder\/frame processing failed/,
    )
    assert.equal(results.fatalStopped, true)
    for (const result of results.partial) {
      assert.equal(result.value, '10012345000017')
      assert.ok(result.nativeCalls > 0)
      assert.deepEqual(result.nativeFormats, ['ean_8', 'ean_13', 'upc_a'])
      assert.equal(result.stopped, true)
    }
    console.log(
      'PASS: ZXing reale in Chromium su 6 SVG: EAN13 9771125522005, EAN8, UPC-A con zero, ITF14, blank e checksum errato; ciclo camera reale su canvas.captureStream e cleanup',
    )
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
