// Real portrait video stream, production CSS, no camera or remote data.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
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
    await page.evaluate(async () => {
      const dialog = document.createElement('dialog')
      dialog.className = 'scanner-panel scanner-dialog'
      dialog.innerHTML =
        '<div class="scanner-sticky"><div class="panel-heading"><h2>Scansiona barcode</h2><button>Chiudi scanner</button></div><div class="scanner-feedback"><strong>9771125522005</strong></div></div><div class="scanner-body"><div class="scanner-preview"><video muted playsinline autoplay></video><span class="scanner-guide"></span></div><button>Prossimo codice</button></div>'
      document.body.append(dialog)
      dialog.showModal()
      const canvas = document.createElement('canvas')
      canvas.width = 720
      canvas.height = 1280
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#20b49a'
      ctx.fillRect(0, 0, 720, 1280)
      ctx.fillStyle = '#ffc64b'
      ctx.fillRect(300, 0, 120, 1280)
      const stream = canvas.captureStream(10)
      window.__previewStream = stream
      const video = dialog.querySelector('video')
      video.srcObject = stream
      const pump = setInterval(() => ctx.fillRect(300, 0, 120, 1280), 100)
      await video.play()
      clearInterval(pump)
    })
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      const metrics = await page.evaluate(() => {
        const dialog = document.querySelector('.scanner-dialog'),
          preview = document.querySelector('.scanner-preview'),
          video = preview.querySelector('video'),
          guide = preview.querySelector('.scanner-guide')
        const p = preview.getBoundingClientRect(),
          v = video.getBoundingClientRect(),
          g = guide.getBoundingClientRect()
        return {
          width: p.width,
          height: p.height,
          videoWidth: v.width,
          videoHeight: v.height,
          fit: getComputedStyle(video).objectFit,
          position: getComputedStyle(video).objectPosition,
          transform: getComputedStyle(video).transform,
          source: [video.videoWidth, video.videoHeight],
          dx: Math.abs(p.x + p.width / 2 - g.x - g.width / 2),
          dy: Math.abs(p.y + p.height / 2 - g.y - g.height / 2),
          overflow: dialog.scrollWidth > dialog.clientWidth,
        }
      })
      assert.ok(metrics.width > metrics.height)
      assert.equal(metrics.height, viewport.width < 640 ? 208 : 256)
      assert.equal(metrics.videoWidth, metrics.width)
      assert.equal(metrics.videoHeight, metrics.height)
      assert.equal(metrics.fit, 'cover')
      assert.equal(metrics.position, '50% 50%')
      assert.equal(metrics.transform, 'none')
      assert.deepEqual(metrics.source, [720, 1280])
      assert.ok(metrics.dx < 1 && metrics.dy < 1)
      assert.equal(metrics.overflow, false)
      const close = await page
        .getByRole('button', { name: 'Chiudi scanner' })
        .boundingBox()
      assert.ok(
        close.x >= 0 &&
          close.x + close.width <= viewport.width &&
          close.y + close.height < viewport.height,
      )
      await page
        .locator('.scanner-preview')
        .screenshot({ path: `/tmp/casetta-m2a3-preview-${viewport.width}.png` })
    }
    await page.evaluate(() =>
      window.__previewStream.getTracks().forEach((track) => track.stop()),
    )
    console.log(
      'PASS: video verticale reale 720x1280 riempie anteprima orizzontale 208/256px; cover centrato, guida centrata, nessun overflow, Chiudi visibile (390x844 e 1280x900)',
    )
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
