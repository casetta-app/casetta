import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startBarcodeCamera } from '../src/scanner/camera.ts'

function fixture(getUserMedia: () => Promise<unknown>) {
  let stopped = 0
  let paused = 0
  let played = 0
  const stream = { getTracks: () => [{ stop: () => stopped++ }] }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia } },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({ getContext: () => ({ drawImage() {} }) }),
    },
  })
  const video = {
    srcObject: null,
    readyState: 2,
    videoWidth: 1280,
    videoHeight: 720,
    setAttribute() {},
    play: async () => {
      played++
    },
    pause: () => {
      paused++
    },
  } as unknown as HTMLVideoElement
  return { video, stream, counts: () => ({ stopped, paused, played }) }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

test('permesso tardivo dopo chiusura rilascia lo stream senza riprodurlo', async () => {
  let grant: (stream: unknown) => void = () => {}
  const f = fixture(
    () =>
      new Promise((resolve) => {
        grant = resolve
      }),
  )
  const stop = startBarcodeCamera(
    f.video,
    () => assert.fail(),
    () => assert.fail(),
    () => assert.fail(),
  )
  stop()
  stop()
  grant(f.stream)
  await tick()
  assert.deepEqual(f.counts(), { stopped: 1, paused: 1, played: 0 })
  assert.equal(f.video.srcObject, null)
})

test('permessi negati e fotocamera occupata terminano senza decoder', async () => {
  for (const name of ['NotAllowedError', 'NotReadableError']) {
    const f = fixture(async () => {
      throw new DOMException('camera', name)
    })
    let received = ''
    startBarcodeCamera(
      f.video,
      () => assert.fail(),
      (error) => {
        received = (error as Error).name
      },
      () => assert.fail(),
    )
    await tick()
    assert.equal(received, name)
    assert.equal(f.video.srcObject, null)
  }
})

test('decoder nativo completo riproduce inline, conserva zeri e cleanup è idempotente', async () => {
  const f = fixture(async () => f.stream)
  let detectCount = 0
  Object.defineProperty(globalThis, 'BarcodeDetector', {
    configurable: true,
    value: class {
      static async getSupportedFormats() {
        return ['ean_8', 'ean_13', 'upc_a', 'itf']
      }
      async detect() {
        detectCount++
        return [{ rawValue: '036000291452', format: 'upc_a' }]
      }
    },
  })
  let result = ''
  const stop = startBarcodeCamera(
    f.video,
    (code) => {
      result = code
    },
    () => assert.fail(),
    () => {},
  )
  await tick()
  assert.equal(result, '036000291452')
  assert.equal(f.video.playsInline, true)
  assert.equal(f.counts().played, 1)
  stop()
  stop()
  const count = detectCount
  await tick()
  assert.equal(detectCount, count)
  assert.equal(f.counts().stopped, 1)
  assert.equal(f.video.srcObject, null)
  Reflect.deleteProperty(globalThis, 'BarcodeDetector')
})
