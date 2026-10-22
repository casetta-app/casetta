// Same decoder for live frames and optical regression samples.
export async function createFrameDecoder() {
  const [{ BrowserMultiFormatReader }, zxing] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ])
  const {
    BarcodeFormat,
    DecodeHintType,
    NotFoundException,
    ChecksumException,
    FormatException,
  } = zxing
  const reader = new BrowserMultiFormatReader(
    new Map<import('@zxing/library').DecodeHintType, unknown>([
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
  return (canvas: HTMLCanvasElement): string | null => {
    try {
      const result = reader.decodeFromCanvas(canvas)
      if (
        result.getBarcodeFormat() === BarcodeFormat.ITF &&
        result.getText().length !== 14
      )
        return null
      return result.getText()
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ChecksumException ||
        error instanceof FormatException
      )
        return null
      throw error
    }
  }
}
