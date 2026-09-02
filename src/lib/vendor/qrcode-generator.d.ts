// Minimal type declarations for the vendored qrcode-generator library.
// See qrcode-generator.js for license/attribution.
declare module "@/lib/vendor/qrcode-generator" {
  type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";
  interface QRCode {
    addData(data: string, mode?: "Numeric" | "Alphanumeric" | "Byte" | "Kanji"): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  }
  interface QRCodeFactory {
    (typeNumber: number, errorCorrectionLevel: ErrorCorrectionLevel): QRCode;
  }
  const qrcode: QRCodeFactory;
  export default qrcode;
}
