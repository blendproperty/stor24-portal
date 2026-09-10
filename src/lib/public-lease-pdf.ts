import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type SignedLeasePdfInput = {
  unsigned?: boolean;
  content: string;
  reference: string;
  paymentMethod: string;
  signerName: string;
  signedAt: Date;
  sha256: string;
};

export async function renderSignedLeasePdf(input: SignedLeasePdfInput) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`Stor24 ${input.unsigned ? "terms review" : "signed agreement"} ${input.reference}`);
  document.setSubject(input.unsigned ? "Storage terms - unsigned review copy" : "Signed Stor24 storage licence agreement");
  document.setAuthor("Stor24");
  document.setCreationDate(input.signedAt);
  document.setModificationDate(input.signedAt);

  const width = 595.28;
  const height = 841.89;
  const margin = 52;
  const lineHeight = 15;
  const maxWidth = width - margin * 2;
  let page = document.addPage([width, height]);
  let y = height - 102;

  const newPage = () => {
    page = document.addPage([width, height]);
    y = height - 102;
  };
  const drawLine = (text: string, font = regular, size = 10, color = rgb(0.04, 0.1, 0.08)) => {
    if (y < 76 + lineHeight) newPage();
    page.drawText(text, { x: margin, y, size, font, color });
    y -= lineHeight;
  };
  const wrap = (text: string, size = 10, font = regular) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const original of words) {
      let word = original;
      // Fingerprints, codes and unusually long names must never cross the margin.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (current) { lines.push(current); current = ""; }
        while (font.widthOfTextAtSize(word, size) > maxWidth) {
          let end = word.length - 1;
          while (font.widthOfTextAtSize(word.slice(0, end), size) > maxWidth) end--;
          lines.push(word.slice(0, end)); word = word.slice(end);
        }
      }
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
      else { if (current) lines.push(current); current = word; }
    }
    if (current) lines.push(current);
    return lines;
  };

  const paragraph = (text: string, font = regular, size = 10) => {
    for (const line of wrap(text, size, font)) drawLine(line, font, size);
  };
  drawLine("Your space. In writing.", bold, 24);
  y -= 16;
  paragraph(`${input.unsigned ? "Edition" : "Reservation"}: ${input.reference}`, bold);
  if (!input.unsigned) paragraph(`Payment choice: ${input.paymentMethod.replaceAll("_", " ")}`);
  y -= 14;
  for (const paragraph of input.content.split("\n")) {
    if (!paragraph.trim()) { y -= 8; continue; }
    const section = /^\d+\.\s|^(YOUR |FULL STORAGE|STOR24 STORAGE)/.test(paragraph);
    if (paragraph === "FULL STORAGE TERMS AND CONDITIONS" && !input.unsigned) newPage();
    if (section && y < 150) newPage();
    if (section) y -= 10;
    for (const line of wrap(paragraph, section ? 12 : 10, section ? bold : regular)) drawLine(line, section ? bold : regular, section ? 12 : 10);
    if (section) y -= 5;
  }
  if (!input.unsigned) {
  newPage();
  drawLine("Electronic signature record", bold, 20);
  y -= 24;
  paragraph(`Signer: ${input.signerName}`, bold, 12);
  paragraph(`Reservation: ${input.reference}`);
  paragraph(`Signed at (UTC): ${input.signedAt.toISOString()}`);
  y -= 18;
  paragraph("The named signer positively acknowledged the agreement clauses and signed electronically. Where this agreement includes full storage terms, acceptance of that exact edition is recorded with the agreement. This record is not a bank mandate, proof of payment or confirmation of access activation.");
  y -= 18;
  paragraph("Accepted document fingerprint (SHA-256)", bold);
  paragraph(input.sha256, regular, 9);
  y -= 18;
  paragraph("Keep this complete document with your booking records. Subsequent website edits do not change the agreement text retained here. Signing metadata and the signed document are retained with the reservation audit record.");
  }
  const pages = document.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawRectangle({ x: 0, y: height - 7, width, height: 7, color: rgb(1, 0.35, 0.04) });
    sheet.drawText("STOR24", { x: margin, y: height - 49, font: bold, size: 20, color: rgb(0.04, 0.1, 0.08) });
    sheet.drawText("STORAGE AGREEMENT", { x: width - margin - 128, y: height - 47, font: bold, size: 9, color: rgb(0.3, 0.34, 0.32) });
    sheet.drawLine({ start: { x: margin, y: 58 }, end: { x: width - margin, y: 58 }, thickness: 0.5, color: rgb(0.8, 0.83, 0.81) });
    sheet.drawText(input.unsigned ? "Legal review copy - unsigned" : "Your retained agreement and acceptance record", { x: margin, y: 40, font: regular, size: 8, color: rgb(0.3, 0.34, 0.32) });
    sheet.drawText(`${index + 1} / ${pages.length}`, { x: width - margin - 30, y: 40, font: bold, size: 8 });
  });
  return document.save({ useObjectStreams: false });
}
