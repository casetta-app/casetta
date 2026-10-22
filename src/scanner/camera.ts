import { normalizeBarcode } from './codes.ts'
import { createFrameDecoder } from './decoder.ts'

const formats = ['ean_8', 'ean_13', 'upc_a', 'itf']
type Detector = {
  detect(
    video: HTMLVideoElement,
  ): Promise<{ rawValue: string; format: string }[]>
}
type DetectorConstructor = {
  new (options: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}
function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timeout fotocamera/decoder')),
      ms,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function startBarcodeCamera(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
  onError: (error: unknown) => void,
  onReady: () => void,
  isPaused = () => false,
) {
  let stopped = false
  let stream: MediaStream | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  let lastTime = 0
  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    stream?.getTracks().forEach((track) => track.stop())
    video.pause()
    video.srcObject = null
  }
  const fail = (error: unknown) => {
    if (!stopped) {
      stop()
      onError(error)
    }
  }
  const emit = (raw: string, itf = false) => {
    if (stopped || isPaused() || (itf && raw.length !== 14)) return false
    const code = normalizeBarcode(raw)
    if (!code) return false
    const now = Date.now()
    if (last === code && now - lastTime < 1200) return true
    last = code
    lastTime = now
    onCode(code)
    return true
  }
  void (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new DOMException('Camera unavailable', 'NotSupportedError')
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      try {
        const track = stream.getVideoTracks?.()[0]
        const capabilities = track?.getCapabilities?.() as
          (MediaTrackCapabilities & { focusMode?: string[] }) | undefined
        if (capabilities?.focusMode?.includes('continuous')) {
          // Optional enhancement: never reject a working camera if focus constraints fail.
          void track
            ?.applyConstraints({
              advanced: [
                { focusMode: 'continuous' } as MediaTrackConstraintSet,
              ],
            })
            .catch(() => {})
        }
      } catch {
        /* Optional focus controls must not block a working stream. */
      }
      video.muted = true
      video.playsInline = true
      video.setAttribute('playsinline', '')
      video.srcObject = stream
      await deadline(video.play(), 10000)
      if (stopped) return
      const Native = (
        globalThis as typeof globalThis & {
          BarcodeDetector?: DetectorConstructor
        }
      ).BarcodeDetector
      let detector: Detector | undefined
      try {
        const supported = Native
          ? await deadline(Native.getSupportedFormats(), 1500)
          : []
        const usable = formats.filter((format) => supported.includes(format))
        if (Native && usable.length) detector = new Native({ formats: usable })
      } catch {
        /* Experimental native API: ZXing remains available. */
      }
      if (stopped) return
      let decode: Awaited<ReturnType<typeof createFrameDecoder>> | undefined
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Canvas non disponibile per la scansione')
      const readyAt = Date.now()
      onReady()
      const read = async () => {
        if (stopped) return
        try {
          if (!isPaused()) {
            if (
              video.readyState >= 2 &&
              video.videoWidth > 0 &&
              video.videoHeight > 0
            ) {
              let found = false
              if (detector) {
                try {
                  const results = await deadline(detector.detect(video), 1500)
                  if (results.length > 1) {
                    if (!stopped) timer = setTimeout(() => void read(), 180)
                    return
                  }
                  if (results.length === 1)
                    found = emit(
                      results[0].rawValue,
                      results[0].format === 'itf',
                    )
                } catch {
                  detector = undefined
                }
              }
              if (!found && !stopped && !isPaused()) {
                decode ??= await deadline(createFrameDecoder(), 10000)
                if (stopped || isPaused()) return schedule()
                // Use intrinsic frame dimensions, never CSS dimensions or a stretched crop.
                canvas.width = video.videoWidth
                canvas.height = video.videoHeight
                context.drawImage(video, 0, 0)
                const value = decode(canvas)
                if (value) emit(value)
              }
            } else if (Date.now() - readyAt > 12000)
              throw new Error('Nessun fotogramma disponibile dalla fotocamera')
          }
          schedule()
        } catch {
          const error = new Error('Decoder/frame processing failed')
          error.name = 'DecoderError'
          fail(error)
        }
      }
      const schedule = () => {
        if (!stopped) timer = setTimeout(() => void read(), 180)
      }
      void read()
    } catch (error) {
      fail(error)
    }
  })()
  return stop
}
