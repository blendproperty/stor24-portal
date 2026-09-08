import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type SignedLeasePdfInput = {
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
  document.setTitle(`Stor24 signed agreement ${input.reference}`);
  document.setSubject("Signed Stor24 storage licence agreement");
  document.setAuthor("Stor24");
  document.setCreationDate(input.signedAt);
  document.setModificationDate(input.signedAt);

  const width = 595.28;
  const height = 841.89;
  const margin = 52;
  const lineHeight = 14;
  const maxWidth = width - margin * 2;
  let page = document.addPage([width, height]);
  let y = height - margin;

  const newPage = () => {
    page = document.addPage([width, height]);
    y = height - margin;
  };
  const drawLine = (text: string, font = regular, size = 10, color = rgb(0.04, 0.1, 0.08)) => {
    if (y < margin + lineHeight) newPage();
    page.drawText(text, { x: margin, y, size, font, color });
    y -= lineHeight;
  };
  const wrap = (text: string, size = 10) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (regular.widthOfTextAtSize(next, size) <= maxWidth) current = next;
      else { if (current) lines.push(current); current = word; }
    }
    if (current) lines.push(current);
    return lines;
  };

  page.drawRectangle({ x: 0, y: height - 20, width, height: 20, color: rgb(1, 0.35, 0.04) });
  drawLine("STOR24 — SIGNED ELECTRONIC AGREEMENT", bold, 16);
  y -= 5;
  drawLine(`Reservation: ${input.reference}`, bold, 10);
  drawLine(`Payment method: ${input.paymentMethod.replaceAll("_", " ")}`, regular, 10);
  drawLine(`Signed by: ${input.signerName}`, regular, 10);
  drawLine(`Signed at: ${input.signedAt.toISOString()}`, regular, 10);
  drawLine(`Document fingerprint: ${input.sha256}`, regular, 8, rgb(0.3, 0.34, 0.32));
  y -= 12;
  for (const paragraph of input.content.split("\n")) {
    if (!paragraph.trim()) { y -= 8; continue; }
    for (const line of wrap(paragraph)) drawLine(line);
  }
  y -= 12;
  drawLine("ELECTRONIC SIGNATURE RECORD", bold, 12);
  drawLine(`${input.signerName} confirmed every clause and signed electronically.`, regular, 10);
  drawLine(`Signed ${input.signedAt.toISOString()} · SHA-256 ${input.sha256}`, regular, 8);
  return document.save({ useObjectStreams: false });
}
