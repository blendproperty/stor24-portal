import qrcodegen from "@/lib/vendor/qrcode-generator";

/**
 * Renders a string (e.g. an otpauth:// authenticator setup URI) as an
 * inline QR code SVG string, entirely client-side using the vendored
 * qrcode-generator library (src/lib/vendor/qrcode-generator.js) — no
 * network call and no dependency on the `qrcode` npm package. The
 * caller never sends the encoded value anywhere; this only renders
 * data already present in the browser.
 *
 * Adjacent dark modules in each row are merged into a single rectangle
 * path segment (rather than emitting one per module) to keep the
 * resulting SVG markup compact.
 */
export function textToQrSvg(text: string, size = 176): string {
  const qr = qrcodegen(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  let path = "";
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const runStart = col;
      while (col < count && qr.isDark(row, col)) col++;
      const runLength = col - runStart;
      const x = runStart * cell;
      const y = row * cell;
      path += `M${x} ${y}h${runLength * cell}v${cell}h${-runLength * cell}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
