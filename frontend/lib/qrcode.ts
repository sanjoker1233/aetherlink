import QRCode from 'qrcode'

/**
 * Render a real, spec-compliant QR code (Reed-Solomon ECC + proper masking)
 * onto a canvas. Replaces the previous hand-rolled encoder which produced
 * unscannable output.
 */
export async function drawQRToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  size = 280
): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#00f5ffff', light: '#0a0a1aff' },
  })
}

/** Data-URL variant (for <img> / download). */
export async function qrDataURL(text: string, size = 280): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#00f5ffff', light: '#0a0a1aff' },
  })
}
