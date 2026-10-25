import { RULE_VERSION, calculateBuffer, calculateSIS } from "./calculations.mjs";
export const uid = () => globalThis.crypto.randomUUID();
export function blankStock(role) {
  return {
    name: "",
    role,
    mw: "",
    lot: "",
    date: "",
    solvent: "",
    source: "weight",
    mass: "",
    massUnit: "mg",
    amount: "",
    amountUnit: "µmol",
    qConcentration: "",
    qUnit: "µmol/L",
    sampleVolume: "",
    sampleUnit: "µL",
    volumeMode: "manual",
    prepVolume: "",
    prepUnit: "µL",
    volumeBasis: "final",
    desiredConcentration: "",
    desiredUnit: "mmol/L",
    available: "",
    availableUnit: "µL",
    target: "",
    targetUnit: "µmol/L",
  };
}
export function blankCocktail() {
  return {
    id: uid(),
    name: "",
    volume: "",
    volumeUnit: "µL",
    assayVolume: "",
    assayUnit: "µL",
    stocks: { S: blankStock("S"), IS: blankStock("IS") },
  };
}
export const blankBuffer = () => ({ name: "", volume: "", volumeUnit: "mL", components: [], demo: false });
export const blankSIS = () => ({
  name: "",
  minimum: "20",
  threshold: "100",
  match: false,
  confirmed: false,
  cocktails: [blankCocktail()],
  demo: false,
});
export function componentFromRow(row, mapping, source) {
  const pick = (key) => (mapping[key] ? String(row[mapping[key]] ?? "") : "");
  return {
    id: uid(),
    name: pick("name"),
    inventory: structuredClone(row),
    inventorySource: source,
    mw: pick("mw"),
    form: "",
    density: pick("density"),
    target: "",
    targetUnit: "mmol/L",
    method: "direct",
    actualMass: "",
    massUnit: "mg",
    stockVolume: "",
    stockVolumeUnit: "mL",
    knownConcentration: "",
    knownUnit: "mmol/L",
    confirmed: false,
    available: "",
    availableUnit: "mL",
    actualTransfer: "",
    transferUnit: "mL",
    actualLiquid: "",
    liquidUnit: "µL",
    reviewed: false,
  };
}
export function demoSIS() {
  const s = blankSIS();
  s.name = "Volume coordination A / B / C";
  s.demo = true;
  s.cocktails = [10, 70, 30].map((originalIS, i) => {
    const c = blankCocktail();
    c.name = ["A", "B", "C"][i];
    c.volume = "600";
    c.assayVolume = "30";
    for (const role of ["S", "IS"])
      Object.assign(c.stocks[role], {
        name: `Demo ${c.name}-${role}`,
        mw: "500",
        lot: "DEMO-ONLY",
        date: "2026-01-15",
        solvent: "Demo solvent",
        source: "qnmr-amount",
        amount: "2",
        prepVolume: "2000",
        target: role === "IS" ? String((originalIS / 600) * 1000) : "100",
      });
    return c;
  });
  return s;
}
export function evaluate(kind, inputs) {
  return kind === "buffer" ? calculateBuffer(inputs) : calculateSIS(inputs);
}
export function makeRecord(kind, inputs, status = "Draft", id = uid(), createdAt = new Date().toISOString()) {
  const results = evaluate(kind, inputs);
  if (!["Draft", "Reviewed"].includes(status)) throw new Error("Unsupported record status.");
  if (status === "Reviewed" && (results.errors.length || (kind === "buffer" && inputs.components.some((c) => !c.reviewed))))
    throw new Error("Resolve validation and complete calculation review before marking Reviewed.");
  return {
    schema: "lab-preparation-record",
    schemaVersion: 1,
    ruleVersion: RULE_VERSION,
    id,
    kind,
    name: inputs.name || "Untitled preparation",
    status,
    demo: !!inputs.demo,
    createdAt,
    updatedAt: new Date().toISOString(),
    inputs: structuredClone(inputs),
    results: structuredClone(results),
  };
}
const STORE = "lab-preparation-workbench.records.v1";
export function validateRecord(r) {
  if (
    !r ||
    r.schema !== "lab-preparation-record" ||
    r.schemaVersion !== 1 ||
    !["buffer", "sis"].includes(r.kind) ||
    typeof r.id !== "string" ||
    typeof r.name !== "string" ||
    !["Draft", "Reviewed"].includes(r.status) ||
    !r.inputs ||
    !r.results ||
    typeof r.ruleVersion !== "string"
  )
    throw new Error("This file is not a supported preparation record.");
  const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
  const checkFields = (value, template, skip = []) => {
    if (!isObject(value)) throw new Error("Invalid input structure.");
    for (const [key, sample] of Object.entries(template)) {
      if (skip.includes(key) || typeof sample === "object") continue;
      if (typeof value[key] !== typeof sample) throw new Error(`Invalid or missing input field: ${key}.`);
    }
  };
  checkFields(r.inputs, r.kind === "buffer" ? blankBuffer() : blankSIS());
  if (!isObject(r.results)) throw new Error("Invalid saved results.");
  if (r.ruleVersion === RULE_VERSION && !Array.isArray(r.results[r.kind === "buffer" ? "rows" : "cocktails"]))
    throw new Error("Incomplete result snapshot.");
  const list = r.kind === "buffer" ? r.inputs.components : r.inputs.cocktails;
  if (!Array.isArray(list) || list.length > 200 || typeof r.inputs.name !== "string" || !Array.isArray(r.results.errors))
    throw new Error("Invalid record structure.");
  for (const item of list) {
    if (!item || typeof item.id !== "string") throw new Error("Invalid record item.");
    if (r.kind === "buffer" && (!item.inventory || typeof item.inventory !== "object" || Array.isArray(item.inventory)))
      throw new Error("Missing inventory snapshot.");
    if (r.kind === "buffer") checkFields(item, componentFromRow({}, {}, ""));
    if (r.kind === "sis") {
      checkFields(item, blankCocktail());
      if (!item.stocks?.S || !item.stocks?.IS) throw new Error("Missing S / IS stock inputs.");
      checkFields(item.stocks.S, blankStock("S"));
      checkFields(item.stocks.IS, blankStock("IS"));
    }
  }
  if (r.status === "Reviewed" && r.results.errors.length) throw new Error("Reviewed record contains validation errors.");
  // Imported results are snapshots, never evidence of independent scientific review.
  return structuredClone(r);
}
export function readRecords(storage = globalThis.localStorage) {
  const raw = storage.getItem(STORE);
  if (!raw) return [];
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error("Saved record list is invalid. Export or restore your browser data before continuing.");
  return rows.map(validateRecord);
}
export function saveRecord(record, storage = globalThis.localStorage) {
  validateRecord(record);
  const rows = readRecords(storage),
    i = rows.findIndex((r) => r.id === record.id);
  if (i < 0) rows.unshift(record);
  else rows[i] = record;
  storage.setItem(STORE, JSON.stringify(rows));
  return record;
}
export function removeRecord(id, storage = globalThis.localStorage) {
  storage.setItem(STORE, JSON.stringify(readRecords(storage).filter((r) => r.id !== id)));
}
export function decodeRecord(text) {
  if (text.length > 12e6) throw new Error("Record file exceeds 12 MB.");
  return validateRecord(
    JSON.parse(text, (k, v) => {
      if (["__proto__", "constructor", "prototype"].includes(k)) throw new Error("Unsafe record property.");
      return v;
    })
  );
}
export function copyRecord(record) {
  const r = validateRecord(record);
  return makeRecord(r.kind, {
    ...r.inputs,
    name: `${r.name} (copy)`,
    ...(r.kind === "sis" ? { confirmed: false } : { components: r.inputs.components.map((c) => ({ ...c, reviewed: false })) }),
  });
}
