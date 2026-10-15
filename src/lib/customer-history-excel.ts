import ExcelJS from "exceljs";
import type { HistoryExportRow } from "./customer-history-document";

const columns = [
  ["recordedAtSast", "Recorded (SAST)", 26],
  ["channel", "Channel", 16],
  ["title", "Communication / note", 36],
  ["body", "Message / note text", 70],
  ["category", "Note category", 22],
  ["author", "Staff author", 25],
  ["store", "Store", 28],
  ["status", "Recorded status", 20],
  ["sentAtSast", "Sent (SAST)", 26],
  ["deliveredAtSast", "Delivered (SAST)", 26],
  ["readAtSast", "Read (SAST)", 26],
  ["subject", "Subject", 40],
  ["evidenceLimit", "Content availability", 65],
  ["customerName", "Customer", 28],
  ["customerId", "Customer reference", 36],
  ["recordId", "Record reference", 36],
  ["kind", "History type", 24],
  ["recordedAtUtc", "Recorded (UTC ISO)", 30],
] as const;

export async function customerHistoryExcel(customer: string, rows: HistoryExportRow[], summary: string, generatedAt: Date) {
  const book = new ExcelJS.Workbook();
  book.creator = "STOR24";
  book.title = "STOR24 customer contact history";
  book.created = generatedAt;
  const sheet = book.addWorksheet("Customer history", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 2, showGridLines: false }],
  });
  sheet.columns = columns.map(([, , width]) => ({ width }));
  const addTextRow = (values: Array<string | number | boolean | null>) => {
    // Plain string cells preserve Unicode and formula-looking customer text as data.
    // Excel cannot retain more than 32,767 characters in a cell: fail, never truncate.
    if (values.some(value => typeof value === "string" && value.length > 32767)) throw new Error("HISTORY_EXPORT_LIMIT");
    return sheet.addRow(values.map(value => value ?? ""));
  };
  addTextRow(["Customer history - " + customer]);
  addTextRow([summary]);
  addTextRow(["Generated " + generatedAt.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) + " SAST | Confidential - authorised staff only."]);
  addTextRow(["Dates and statuses reproduce recorded evidence. Missing message content is identified. Expand row height to read longer notes."]);
  addTextRow(columns.map(([, title]) => title));
  for (const source of rows) {
    const row = addTextRow(columns.map(([key]) => source[key] ?? ""));
    row.alignment = { vertical: "top", wrapText: true };
    row.font = { name: "Arial", size: 10, color: { argb: "FF17343C" } };
    row.height = Math.min(300, Math.max(45, String(source.body ?? "").split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 65)), 0) * 14 + 8));
    if (row.number % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F6F6" } };
  }
  if (!rows.length) addTextRow(["No recorded history matches the selected filters."]);
  for (const index of [1, 5]) {
    const row = sheet.getRow(index);
    row.font = { name: "Arial", size: index === 1 ? 15 : 10, bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17343C" } };
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = 32;
  }
  for (const index of [1, 2, 3, 4]) sheet.mergeCells(index, 1, index, columns.length);
  for (const index of [2, 3, 4]) {
    sheet.getRow(index).font = { name: "Arial", size: 10, color: { argb: "FF53676E" } };
    sheet.getRow(index).alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(index).height = 30;
  }
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, rows.length + 5), column: columns.length } };
  return new Uint8Array(await book.xlsx.writeBuffer());
}
