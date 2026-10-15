import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import type { HistoryExportRow } from "../src/lib/customer-history-document";
import { customerHistoryExcel } from "../src/lib/customer-history-excel";

test("history Excel retains complete Unicode text, evidence and references without interpreting formulas", async () => {
  const body = "=HYPERLINK(\"https://example.invalid\")\nHi Faeez 👋 — Möller\n" + "Full note line\n".repeat(300);
  const rows: HistoryExportRow[] = [{ recordId: "note-1", kind: "NOTE", body, recordedAtUtc: "2026-10-14T09:30:00.792Z", recordedAtSast: "2026/10/14, 11:30:00 SAST", author: "Synthetic Faeez", category: "HANDOVER", store: "Midpoint", title: "Staff handover" }, { recordId: "comm-2", kind: "COMMUNICATION", channel: "EMAIL", status: "SUCCEEDED", body: "", evidenceLimit: "Original message text not retained in this historical log", subject: "+Formula-looking subject" }];
  const bytes = await customerHistoryExcel("Synthetic customer", rows, "Filtered stored history", new Date("2026-10-15T08:00:00Z"));
  assert.equal(Buffer.from(bytes).subarray(0, 2).toString(), "PK");
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes.buffer as ArrayBuffer);
  const sheet = book.getWorksheet("Customer history")!;
  assert.equal(sheet.rowCount, 7); assert.equal(sheet.columnCount, 18);
  assert.equal(sheet.getCell("D6").value, body); assert.equal(sheet.getCell("D6").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("L7").value, "+Formula-looking subject");
  assert.equal(sheet.getCell("R6").value, rows[0].recordedAtUtc);
  assert.equal(sheet.getCell("A6").value, rows[0].recordedAtSast);
  assert.equal(sheet.getCell("F6").value, "Synthetic Faeez"); assert.equal(sheet.getCell("E6").value, "HANDOVER");
  assert.equal(sheet.getCell("M7").value, rows[1].evidenceLimit); assert.equal(sheet.getCell("P7").value, "comm-2");
  assert.equal(sheet.autoFilter, "A5:R7");
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal((sheet.views[0] as { ySplit: number }).ySplit, 5);
  sheet.eachRow(row => row.eachCell(cell => assert.notEqual(cell.type, ExcelJS.ValueType.Formula)));
});

test("empty Excel keeps headers and says no matches; oversized cells fail instead of truncating", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await customerHistoryExcel("Synthetic", [], "No matching filters", new Date())).buffer as ArrayBuffer);
  const sheet = book.worksheets[0];
  assert.equal(sheet.getCell("D5").value, "Message / note text");
  assert.match(String(sheet.getCell("A6").value), /No recorded history/);
  await assert.rejects(customerHistoryExcel("Synthetic", [{ body: "x".repeat(32768) }], "", new Date()), /HISTORY_EXPORT_LIMIT/);
});
