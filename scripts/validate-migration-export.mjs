import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const contracts = {
  facilities: ["legacy_id", "name", "code", "timezone"],
  unit_types: ["legacy_id", "facility_legacy_id", "name", "width_metres", "length_metres", "area_sq_metres"],
  units: ["legacy_id", "facility_legacy_id", "unit_type_legacy_id", "number", "status", "monthly_rate"],
  customers: ["legacy_id", "first_name", "last_name", "company_name", "email", "phone"],
  tenancies: ["legacy_id", "facility_legacy_id", "customer_legacy_id", "unit_legacy_id", "status", "start_date", "end_date", "monthly_rate"],
  reservations: ["legacy_id", "facility_legacy_id", "customer_legacy_id", "unit_legacy_id", "status", "quoted_rate", "hold_expires_at", "intended_move_in"],
};

function parseCsv(source) {
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && quoted && source[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else value += character;
  }
  if (value || row.length) { row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); }
  return rows;
}

function records(rows, required, file, errors) {
  const header = rows[0]?.map((value) => value.trim()) ?? [];
  for (const field of required) if (!header.includes(field)) errors.push(`${file}: missing required column ${field}`);
  return rows.slice(1).flatMap((values, rowIndex) => {
    const record = Object.fromEntries(header.map((field, index) => [field, values[index]?.trim() ?? ""]));
    if (!record.legacy_id) {
      errors.push(`${file}: row ${rowIndex + 2} has no legacy_id`);
      return [];
    }
    return [record];
  });
}

function idSet(rows, file, errors) {
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.legacy_id)) errors.push(`${file}: duplicate legacy_id ${row.legacy_id}`);
    ids.add(row.legacy_id);
  }
  return ids;
}

function requireReference(rows, field, targets, file, errors) {
  for (const row of rows) if (row[field] && !targets.has(row[field])) errors.push(`${file}: ${row.legacy_id} references missing ${field} ${row[field]}`);
}

const sourceDirectory = resolve(process.argv[2] ?? "migration/templates");
const outputPath = resolve(process.argv[3] ?? "migration-validation.json");
const errors = []; const data = {};
for (const [name, required] of Object.entries(contracts)) {
  const file = `${name}.csv`;
  try { data[name] = records(parseCsv(await readFile(resolve(sourceDirectory, file), "utf8")), required, file, errors); }
  catch (error) { errors.push(`${file}: ${error instanceof Error ? error.message : "could not be read"}`); data[name] = []; }
}

const ids = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, idSet(rows, `${name}.csv`, errors)]));
requireReference(data.unit_types, "facility_legacy_id", ids.facilities, "unit_types.csv", errors);
requireReference(data.units, "facility_legacy_id", ids.facilities, "units.csv", errors);
requireReference(data.units, "unit_type_legacy_id", ids.unit_types, "units.csv", errors);
for (const file of ["tenancies", "reservations"]) {
  requireReference(data[file], "facility_legacy_id", ids.facilities, `${file}.csv`, errors);
  requireReference(data[file], "customer_legacy_id", ids.customers, `${file}.csv`, errors);
  requireReference(data[file], "unit_legacy_id", ids.units, `${file}.csv`, errors);
}

const report = { generatedAt: new Date().toISOString(), sourceDirectory, valid: errors.length === 0, counts: Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length])), errors };
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
