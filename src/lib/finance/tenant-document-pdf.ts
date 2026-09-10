import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { AccountStatementData } from "@/lib/finance/statement-data";
import { formatSouthAfricaDate } from "@/lib/south-africa-time";

type DocumentInput = { title: string; reference: string; customerName: string; subtitle: string; columns: string[]; rows: string[][]; notes: string[] };
export async function renderTenantDocumentPdf(input: DocumentInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`STOR24 ${input.title} ${input.reference}`); pdf.setAuthor("STOR24");
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(await readFile(path.join(process.cwd(), "public/brand/stor24-logo-official-email-20260909.png")));
  const ink = rgb(.03, .08, .06), muted = rgb(.32, .38, .35), orange = rgb(1, .35, .04);
  const safe = (value: string) => value.replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const widths = input.columns.length === 5 ? [73, 182, 75, 75, 90] : [125, 370];
  let page = pdf.addPage([595.28, 841.89]), y = 650;
  const wrap = (text: string, width: number, size = 9) => {
    const lines: string[] = []; let line = "";
    for (const word of safe(text).split(/\s+/)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { lines.push(line); line = ""; }
      if (font.widthOfTextAtSize(word, size) > width) {
        for (const character of word) {
          if (font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
          line += character;
        }
      } else line += `${line ? " " : ""}${word}`;
    }
    if (line || !lines.length) lines.push(line.trim());
    return lines;
  };
  const fit = (text: string, size: number) => {
    let value = safe(text);
    while (bold.widthOfTextAtSize(value, size) > 490) value = `${value.slice(0, -4)}...`;
    return value;
  };
  const header = () => {
    page.drawRectangle({ x: 0, y: 834, width: 596, height: 8, color: orange });
    page.drawImage(logo, { x: 50, y: 756, width: 137.5, height: 36 });
    page.drawText(safe(input.title.toUpperCase()), { x: 50, y: 721, size: 18, font: bold, color: ink });
    page.drawText(fit(input.customerName, 11), { x: 50, y: 700, size: 11, font: bold, color: ink });
    page.drawText(fit(input.reference, 9), { x: 50, y: 684, size: 9, font, color: muted });
    page.drawText(fit(input.subtitle, 9), { x: 50, y: 668, size: 9, font, color: muted });
    y = 640;
    let x = 50;
    input.columns.forEach((column, i) => { page.drawText(column, { x: x + 4, y, size: 9, font: bold, color: ink }); x += widths[i]; });
    y -= 15;
  };
  const nextPage = () => { page = pdf.addPage([595.28, 841.89]); header(); };
  header();
  for (const [rowIndex, row] of input.rows.entries()) {
    const lines = row.map((cell, i) => wrap(cell, widths[i] - 10));
    const height = Math.max(...lines.map(part => part.length)) * 13 + 14;
    if (height > 500) throw new Error("DOCUMENT_ROW_TOO_LONG");
    const notesSpace = rowIndex === input.rows.length - 1 ? 16 + input.notes.reduce((sum, note) => sum + wrap(note, 485, 9).length * 13 + 8, 0) : 0;
    if (y - height - Math.min(notesSpace, 180) < 85) nextPage();
    let x = 50;
    lines.forEach((cell, i) => { cell.forEach((line, j) => page.drawText(line, { x: x + 4, y: y - 10 - j * 13, size: 9, font, color: ink })); x += widths[i]; });
    y -= height;
    page.drawLine({ start: { x: 50, y: y + 5 }, end: { x: 545, y: y + 5 }, thickness: .5, color: rgb(.85, .88, .86) });
  }
  y -= 16;
  for (const note of input.notes) {
    for (const line of wrap(note, 485, 9)) {
      if (y < 85) nextPage();
      page.drawText(line, { x: 50, y, size: 9, font, color: muted }); y -= 13;
    }
    y -= 8;
  }
  pdf.getPages().forEach((sheet, i, pages) => {
    sheet.drawText("STOR24 | Space for life in motion.", { x: 50, y: 42, size: 8, font, color: muted });
    sheet.drawText(`Page ${i + 1} of ${pages.length}`, { x: 477, y: 42, size: 8, font, color: muted });
  });
  return pdf.save();
}

export function renderAccountStatementPdf(statement: AccountStatementData) {
  const money = (value: string) => `${statement.currency} ${Number(value).toFixed(2)}`;
  return renderTenantDocumentPdf({ title: "Account statement", reference: statement.accountNumber, customerName: statement.customerName,
    subtitle: `${statement.from} to ${statement.to} | ${statement.facilityName}`,
    columns: ["Date", "Description", "Debit", "Credit", "Balance"],
    rows: [["", "Opening balance", "", "", money(statement.openingBalance)], ...statement.rows.map(row => [formatSouthAfricaDate(row.date), row.description, Number(row.debit) ? money(row.debit) : "-", Number(row.credit) ? money(row.credit) : "-", money(row.balance)]), ["", "Closing balance", "", "", money(statement.closingBalance)]],
    notes: [`Prepared ${formatSouthAfricaDate(statement.generatedAt)}. A negative balance is a credit on your account.`, "This is a statement of transactions recorded in STOR24, not a tax invoice or bank settlement confirmation. Pending payments and booking estimates are excluded. Please contact STOR24 if anything does not look right."] });
}
