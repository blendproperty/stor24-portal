import { readFile, open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const contracts = {
  facilities: ["legacy_id", "name", "code", "timezone"],
  unit_types: ["legacy_id", "facility_legacy_id", "name", "width_metres", "length_metres", "area_sq_metres"],
  units: ["legacy_id", "facility_legacy_id", "unit_type_legacy_id", "number", "status", "monthly_rate"],
  customers: ["legacy_id", "first_name", "last_name", "company_name", "email", "phone"],
  tenancies: ["legacy_id", "facility_legacy_id", "customer_legacy_id", "unit_legacy_id", "status", "start_date", "end_date", "monthly_rate"],
  reservations: ["legacy_id", "facility_legacy_id", "customer_legacy_id", "unit_legacy_id", "status", "quoted_rate", "hold_expires_at", "intended_move_in"],
};

function parseCsv(source) {
  const rows = []; let row = []; let value = ""; let quoted = false; let closedQuote = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && quoted && source[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') {
      if (quoted) { quoted = false; closedQuote = true; }
      else if (!value && !closedQuote) quoted = true;
      else throw new Error("CSV quote must start at the beginning of a field");
    }
    else if (character === "," && !quoted) { row.push(value); value = ""; closedQuote = false; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value); value = ""; closedQuote = false;
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else {
      if (closedQuote) throw new Error("CSV has characters after a closing quote");
      value += character;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field");
  if (value || row.length) { row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); }
  return rows;
}

function records(rows, required, file, errors) {
  const header = rows[0]?.map((value) => value.trim()) ?? [];
  if (header.some(field => !field)) errors.push(`${file}: empty header column`);
  if (new Set(header).size !== header.length) errors.push(`${file}: duplicate header column`);
  for (const field of required) if (!header.includes(field)) errors.push(`${file}: missing required column ${field}`);
  return rows.slice(1).flatMap((values, rowIndex) => {
    if (values.length !== header.length) {
      errors.push(`${file}: row ${rowIndex + 2} column count ${values.length} does not match header ${header.length}`);
      return [];
    }
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
  for (const row of rows) {
    if (!row[field]) errors.push(`${file}: ${row.legacy_id} missing required reference ${field}`);
    else if (!targets.has(row[field])) errors.push(`${file}: ${row.legacy_id} references missing ${field} ${row[field]}`);
  }
}

function requireUniqueKey(rows, fields, file, errors) {
  const seen = new Map();
  for (const row of rows) {
    // Match the database's case-sensitive composite keys, without coercing
    // unit numbers (for example, 01 and 1 are distinct identifiers).
    const key = JSON.stringify(fields.map(field => row[field]));
    const prior = seen.get(key);
    if (prior !== undefined) errors.push(`${file}: ${row.legacy_id} duplicate business key (${fields.join(", ")}) also used by ${prior}`);
    else seen.set(key, row.legacy_id);
  }
}

function requireSameFacility(rows, field, targets, file, errors) {
  const byId = new Map(targets.map(row => [row.legacy_id, row]));
  for (const row of rows) {
    const target = byId.get(row[field]);
    if (target && row.facility_legacy_id && target.facility_legacy_id && row.facility_legacy_id !== target.facility_legacy_id) {
      errors.push(`${file}: ${row.legacy_id} ${field} ${row[field]} belongs to a different facility`);
    }
  }
}

const sourceDirectory = resolve(process.argv[2] ?? "migration/templates");
const outputPath = resolve(process.argv[3] ?? "migration-validation.json");
const sourcePaths = Object.keys(contracts).map(name => resolve(sourceDirectory, `${name}.csv`));
const pathKey = path => process.platform === "win32" ? path.toLowerCase() : path;
if (sourcePaths.some(path => pathKey(path) === pathKey(outputPath))) {
  throw new Error("Report output cannot overwrite a source file");
}
const errors = []; const data = {}; const sourceFiles = {};
for (const [name, required] of Object.entries(contracts)) {
  const file = `${name}.csv`;
  try {
    const bytes = await readFile(resolve(sourceDirectory, file));
    sourceFiles[file] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
    data[name] = records(parseCsv(bytes.toString("utf8")), required, file, errors);
  }
  catch (error) { errors.push(`${file}: ${error instanceof Error ? error.message : "could not be read"}`); data[name] = []; }
}

const ids = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, idSet(rows, `${name}.csv`, errors)]));
// One export package targets one organisation; facility codes are unique there.
requireUniqueKey(data.facilities, ["code"], "facilities.csv", errors);
requireUniqueKey(data.unit_types, ["facility_legacy_id", "name"], "unit_types.csv", errors);
requireUniqueKey(data.units, ["facility_legacy_id", "number"], "units.csv", errors);
requireReference(data.unit_types, "facility_legacy_id", ids.facilities, "unit_types.csv", errors);
requireReference(data.units, "facility_legacy_id", ids.facilities, "units.csv", errors);
requireReference(data.units, "unit_type_legacy_id", ids.unit_types, "units.csv", errors);
requireSameFacility(data.units, "unit_type_legacy_id", data.unit_types, "units.csv", errors);
for (const file of ["tenancies", "reservations"]) {
  requireReference(data[file], "facility_legacy_id", ids.facilities, `${file}.csv`, errors);
  requireReference(data[file], "customer_legacy_id", ids.customers, `${file}.csv`, errors);
  requireReference(data[file], "unit_legacy_id", ids.units, `${file}.csv`, errors);
  requireSameFacility(data[file], "unit_legacy_id", data.units, `${file}.csv`, errors);
}

const valid = errors.length === 0;
const contractsByCustomer = new Set([...data.tenancies, ...data.reservations].map(row => row.customer_legacy_id));
const reconciliation = {
  ready: valid,
  byFacility: valid ? data.facilities.map(facility => {
    const local = name => data[name].filter(row => row.facility_legacy_id === facility.legacy_id);
    return {
      facilityLegacyId: facility.legacy_id,
      unitTypes: local("unit_types").length,
      units: local("units").length,
      tenancies: local("tenancies").length,
      reservations: local("reservations").length,
      linkedCustomers: new Set([...local("tenancies"), ...local("reservations")].map(row => row.customer_legacy_id)).size,
    };
  }) : null,
  customersWithoutContracts: valid ? data.customers.filter(row => !contractsByCustomer.has(row.legacy_id)).length : null,
};
const report = { generatedAt: new Date().toISOString(), sourceDirectory, valid, sourceFiles, counts: Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length])), reconciliation, errors };
// Open without truncating, then compare the actual file identity. This also
// protects source files reached through symlinks or hard links.
const output = await open(outputPath, "r+").catch(error => {
  if (error.code !== "ENOENT") throw error;
  return open(outputPath, "wx");
});
try {
  const outputIdentity = await output.stat();
  for (const path of sourcePaths) {
    const sourceIdentity = await stat(path).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (sourceIdentity && sourceIdentity.dev === outputIdentity.dev && sourceIdentity.ino === outputIdentity.ino) {
      throw new Error("Report output cannot overwrite a source file");
    }
  }
  await output.truncate(0);
  await output.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
} finally { await output.close(); }
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
