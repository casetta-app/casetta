import { normalizeBarcode } from './codes.ts'

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

// Synchronous cancellation also owns permission requests that resolve after closing.
export function startBarcodeCamera(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
  onError: (error: unknown) => void,
  onReady: () => void,
) {
  let stopped = false
  let stream: MediaStream | undefined
  let decoder: { stop(): void } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  let lastTime = 0
  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    decoder?.stop()
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
    if (stopped || (itf && raw.length !== 14)) return
    const code = normalizeBarcode(raw)
    if (!code) return
    const now = Date.now()
    if (last === code && now - lastTime < 1200) return
    last = code
    lastTime = now
    onCode(code)
  }
  const fallback = async () => {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
      await Promise.all([import('@zxing/browser'), import('@zxing/library')])
    if (stopped) return
    const reader = new BrowserMultiFormatReader(
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
      ]),
      { delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 500 },
    )
    decoder = reader.scan(
      video,
      (result) => {
        if (result)
          emit(
            result.getText(),
            result.getBarcodeFormat() === BarcodeFormat.ITF,
          )
      },
      fail,
    )
    if (stopped) decoder.stop()
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
      video.muted = true
      video.playsInline = true
      video.setAttribute('playsinline', '')
      video.srcObject = stream
      await video.play()
      if (stopped) return
      onReady()
      const Native = (
        globalThis as typeof globalThis & {
          BarcodeDetector?: DetectorConstructor
        }
      ).BarcodeDetector
      let detector: Detector | undefined
      try {
        const supported = await Native?.getSupportedFormats()
        if (Native && formats.every((format) => supported?.includes(format)))
          detector = new Native({ formats })
      } catch {
        /* Experimental or partial native support uses ZXing. */
      }
      if (stopped) return
      if (!detector) {
        await fallback()
        return
      }
      const read = async () => {
        if (stopped) return
        try {
          if (video.readyState >= 2) {
            const results = await detector!.detect(video)
            if (results.length === 1)
              emit(results[0].rawValue, results[0].format === 'itf')
          }
          if (!stopped) timer = setTimeout(() => void read(), 180)
        } catch {
          if (!stopped) {
            try {
              await fallback()
            } catch (error) {
              fail(error)
            }
          }
        }
      }
      void read()
    } catch (error) {
      fail(error)
    }
  })()
  return stop
}
