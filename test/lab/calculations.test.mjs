import test from "node:test";
import assert from "node:assert/strict";
import {
  positive,
  massMg,
  volumeUL,
  concentrationMM,
  stockFromWeight,
  stockFromAmount,
  amountFromQNMR,
  requiredBufferMass,
  needsStock,
  aliquot,
  assayMass,
  coordinateVolumes,
  calculateSingle,
  calculateCocktail,
  calculateBufferComponent,
  calculateBuffer,
  calculateSIS,
} from "../../assets/js/lab/calculations.mjs";
import {
  blankBuffer,
  blankSIS,
  blankStock,
  blankCocktail,
  demoSIS,
  componentFromRow,
  makeRecord,
  saveRecord,
  readRecords,
  decodeRecord,
  copyRecord,
} from "../../assets/js/lab/models.mjs";
import { parseCSV, tableFromRows, matchingRows } from "../../assets/js/lab/inventory.mjs";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const stock = (extra = {}) => ({
  ...blankStock("S"),
  name: "Compound",
  mw: "500",
  lot: "LOT-1",
  date: "2026-04-01",
  solvent: "Water",
  mass: "5",
  prepVolume: "2000",
  target: "100",
  ...extra,
});
const component = (extra = {}) => ({
  ...componentFromRow({ Name: "Glycine", MW: "100" }, { name: "Name", mw: "MW" }, "Test.csv"),
  form: "solid",
  target: "1",
  actualMass: "100",
  ...extra,
});
const coordinated = (volumes = [600, 600, 600]) =>
  [10, 70, 30].map((is, i) => ({ id: String(i), volume: volumes[i], stockMM: 1, targetUM: (is / 600) * 1000 }));

test("mass, volume, and concentration units normalize before calculation", () => {
  near(massMg(0.1, "g"), 100);
  near(massMg(500, "µg"), 0.5);
  near(volumeUL(0.002, "L"), 2000);
  near(volumeUL(2, "mL"), 2000);
  near(concentrationMM(0.001, "mol/L"), 1);
  near(concentrationMM(1000, "µmol/L"), 1);
  near(concentrationMM(1, "g/L", 100), 10);
  near(concentrationMM(1, "mg/mL", 100), 10);
});
test("mass / MW / µL gives mM without early rounding", () => {
  near(stockFromWeight(11.24, 394.376, 1835), (11.24 / 394.376 / 1835) * 1e6);
  near(stockFromWeight(5, 500, 2000), 5);
});
test("qNMR amount µmol is distinct from concentration µM", () => {
  near(stockFromAmount(4.929, 2000), 2.4645);
  near(amountFromQNMR(100, "µmol/L", 500), 0.05);
  near(stockFromAmount(amountFromQNMR(100, "µmol/L", 500), 1000), 0.05);
  assert.throws(() => amountFromQNMR(100, "µmol/L", ""), /required/);
});
test("all invalid, absent, zero, and negative inputs are rejected distinctly", () => {
  for (const v of ["", null, undefined, " "]) assert.throws(() => positive(v), /required/);
  for (const v of [0, -1, "0", "-1"]) assert.throws(() => positive(v), /greater than zero/);
  for (const v of ["abc", Infinity, NaN, {}, []]) assert.throws(() => positive(v), /finite/);
  assert.throws(() => volumeUL(1, "oz"), /Unsupported/);
  assert.throws(() => concentrationMM(1, "w/v"), /Unsupported/);
  assert.throws(() => stockFromWeight(1e308, 1, 1e-300), /numeric range/);
});
test("per-assay mass and transfer differ from full cocktail transfer", () => {
  near(assayMass(250, 30, 500), 3.75);
  near(aliquot(250, 5, 30), 1.5);
  near(aliquot(250, 5, 600), 30);
});
test("buffer below 100 mg forces stock; exactly 100 mg allows direct weighing", () => {
  near(requiredBufferMass(1, 1000, 100), 100);
  assert.equal(needsStock(99.999), true);
  assert.equal(needsStock(100), false);
  const low = calculateBufferComponent(component({ target: ".99999", stockVolume: "100", actualTransfer: "10" }), 1000, "mL");
  assert.equal(low.forcedStock, true);
  assert.equal(low.method, "new");
  const edge = calculateBufferComponent(component(), 1000, "mL");
  assert.equal(edge.forcedStock, false);
  assert.equal(edge.method, "direct");
  near(edge.actualMM, 1);
});
test("new buffer stock uses actual weighed mass and final solution volume", () => {
  const r = calculateBufferComponent(
    component({ target: ".5", actualMass: "51", stockVolume: "100", actualTransfer: "98.0392156862745" }),
    1000,
    "mL"
  );
  assert.deepEqual(r.errors, []);
  near(r.requiredMg, 50);
  near(r.stockMM, 5.1);
  near(r.transferML, 98.0392156862745);
  near(r.actualMM, 0.5);
});
test("buffer existing solution requires concentration confirmation and available stock", () => {
  const c = component({ form: "solution", knownConcentration: "10", available: "200", actualTransfer: "100" });
  const a = calculateBufferComponent(c, 1000, "mL");
  assert.ok(a.errors.some((x) => x.includes("Confirm")));
  const b = calculateBufferComponent({ ...c, confirmed: true }, 1000, "mL");
  assert.deepEqual(b.errors, []);
  near(b.transferML, 100);
  near(b.actualMM, 1);
});
test("pure liquids use density; solutions never use density as concentration", () => {
  const r = calculateBufferComponent(component({ form: "pure-liquid", density: "1.05", actualLiquid: "95.23809523809524" }), 1000, "mL");
  near(r.requiredLiquidUL, 95.23809523809524);
  near(r.actualMM, 1);
  const missing = calculateBufferComponent(component({ form: "pure-liquid" }), 1000, "mL");
  assert.ok(missing.errors.some((x) => x.includes("Density")));
  const solution = calculateBufferComponent(component({ form: "solution", density: "1.05" }), 1000, "mL");
  assert.ok(solution.errors.some((x) => x.includes("Concentration")));
});
test("empty buffer is a valid incomplete draft, never valid for review", () => {
  const r = calculateBuffer(blankBuffer());
  assert.ok(r.errors.length);
  assert.throws(() => makeRecord("buffer", blankBuffer(), "Reviewed"));
  assert.equal(makeRecord("buffer", blankBuffer()).status, "Draft");
});
test("missing actual input leaves required buffer mass visible without converting blanks to zero", () => {
  const r = calculateBufferComponent(component({ actualMass: "" }), 1000, "mL");
  near(r.requiredMg, 100);
  assert.equal(r.actualMM, null);
  assert.ok(r.errors.some((x) => x.includes("required")));
});
test("buffer detects combined liquid additions beyond final volume", () => {
  const b = {
    name: "Overfilled",
    volume: "1000",
    volumeUnit: "mL",
    components: [
      component({ form: "pure-liquid", density: "1", actualLiquid: "600", liquidUnit: "mL" }),
      component({ form: "pure-liquid", density: "1", actualLiquid: "600", liquidUnit: "mL" }),
    ],
  };
  assert.ok(calculateBuffer(b).errors.some((e) => e.includes("Combined liquid")));
});
test("single-standard manual volume, target volume and solvent approximation are explicit", () => {
  const a = calculateSingle(stock());
  near(a.stockMM, 5);
  assert.deepEqual(a.errors, []);
  const b = calculateSingle(stock({ volumeMode: "target", desiredConcentration: "10" }));
  near(b.prepUL, 1000);
  near(b.stockMM, 10);
  assert.ok(calculateSingle(stock({ volumeBasis: "solvent" })).warnings.some((e) => e.includes("approximation")));
});
test("single-standard strict <3000 µL and availability constraints", () => {
  assert.equal(calculateSingle(stock({ prepVolume: "2999" })).errors.length, 0);
  assert.ok(calculateSingle(stock({ prepVolume: "3000" })).errors.some((e) => e.includes("<3000")));
  assert.ok(calculateSingle(stock({ available: "2001" })).errors.some((e) => e.includes("exceed prepared")));
});
test("qNMR concentration requires its sample volume even if preparation volume is given", () => {
  const r = calculateSingle(stock({ source: "qnmr-concentration", qConcentration: "100", sampleVolume: "500" }));
  near(r.amountUmol, 0.05);
  near(r.stockMM, 0.025);
  assert.ok(calculateSingle(stock({ source: "qnmr-concentration", qConcentration: "100" })).errors.length);
});
test("A/B/C acceptance case preserves B and scales every component within A and C", () => {
  const p = coordinateVolumes(coordinated());
  assert.deepEqual(
    p.map((r) => r.selectedVolume),
    [1200, 600, 1200]
  );
  p.forEach((r, i) => near(r.finalIS, [20, 70, 60][i]));
  assert.equal(p[1].reason, "Original volume retained: scaled IS aliquot would exceed 100 µL.");
  const s = demoSIS();
  s.confirmed = true;
  const r = calculateSIS(s);
  assert.deepEqual(r.errors, []);
  near(r.cocktails[0].rows[0].transferUL, 120);
  near(r.cocktails[1].rows[0].transferUL, 60);
  near(r.cocktails[2].rows[0].transferUL, 120);
  near(r.cocktails[0].solventUL, 1060);
});
test("IS exactly 20 µL does not scale; below 20 scales", () => {
  const b = [{ id: "x", volume: 600, stockMM: 1, targetUM: (20 / 600) * 1000 }];
  near(coordinateVolumes(b)[0].selectedVolume, 600);
  near(coordinateVolumes([{ ...b[0], targetUM: (10 / 600) * 1000 }])[0].selectedVolume, 1200);
});
test("scaled IS exactly 100 follows common volume; >100 retains eligible original", () => {
  const a = { id: "a", volume: 600, stockMM: 1, targetUM: (10 / 600) * 1000 },
    b = { id: "b", volume: 600, stockMM: 1, targetUM: (50 / 600) * 1000 };
  near(coordinateVolumes([a, b])[1].selectedVolume, 1200);
  near(coordinateVolumes([a, { ...b, targetUM: (50.01 / 600) * 1000 }])[1].selectedVolume, 600);
});
test("threshold is a coordination decision, not an IS usage hard cap", () => {
  const p = coordinateVolumes([{ id: "x", volume: 600, stockMM: 1, targetUM: 200 }]);
  near(p[0].finalIS, 120);
  near(p[0].selectedVolume, 600);
});
test("all original IS aliquots sufficient means no automatic scaling", () => {
  const p = coordinateVolumes([
    { id: "a", volume: 600, stockMM: 1, targetUM: 50 },
    { id: "b", volume: 600, stockMM: 1, targetUM: 100 },
  ]);
  assert.deepEqual(
    p.map((r) => r.selectedVolume),
    [600, 600]
  );
});
test("different originals need explicit Match; proposed volume never shrinks originals", () => {
  const b = coordinated([600, 900, 600]);
  const p = coordinateVolumes(b);
  assert.deepEqual(
    p.map((r) => r.selectedVolume),
    [600, 900, 600]
  );
  const m = coordinateVolumes(b, 20, 100, true);
  assert.ok(m.every((r) => r.proposedVolume >= 900));
  near(m[0].finalIS, 20);
  assert.throws(() => coordinateVolumes(b, 19), /≥20/);
});
test("original IS below minimum cannot be retained just to obey threshold", () => {
  const p = coordinateVolumes(
    [
      { id: "a", volume: 600, stockMM: 1, targetUM: 1 },
      { id: "b", volume: 600, stockMM: 1, targetUM: 10 },
    ],
    20,
    100
  );
  assert.ok(p.every((r) => r.finalIS >= 20));
  near(p[1].selectedVolume, 2000);
});
test("missing MW still permits qNMR volume calculation but never invents zero mass", () => {
  const c = blankCocktail();
  Object.assign(c, { assayVolume: "30" });
  c.stocks.S = stock({ source: "qnmr-amount", amount: "10", mw: "" });
  c.stocks.IS = stock({ source: "qnmr-amount", amount: "1", mw: "", target: "5" });
  const r = calculateCocktail(c, 600);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0].massUG, null);
  near(r.rows[0].transferUL, 12);
});
test("negative solvent, insufficient stock, and missing targets block review", () => {
  const c = blankCocktail();
  c.assayVolume = "30";
  c.stocks.S = stock({ target: "4000", available: "100" });
  c.stocks.IS = stock({ target: "4000" });
  const r = calculateCocktail(c, 600);
  assert.ok(r.solventUL < 0);
  assert.ok(r.errors.some((e) => e.includes("negative")));
  assert.ok(r.errors.some((e) => e.includes("available")));
  c.stocks.S.target = "";
  assert.ok(calculateCocktail(c, 600).errors.some((e) => e.includes("required")));
});
test("unconfirmed volume plan cannot become Reviewed; confirmed valid demo can", () => {
  const s = demoSIS();
  assert.throws(() => makeRecord("sis", s, "Reviewed"));
  s.confirmed = true;
  const r = makeRecord("sis", s, "Reviewed");
  assert.equal(r.status, "Reviewed");
  assert.equal(r.demo, true);
});
test("save/reopen JSON preserves full precision, inputs, rule snapshot and inventory fields", () => {
  const store = new Map(),
    storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const b = {
    ...blankBuffer(),
    name: "Snapshot",
    volume: "1000",
    components: [component({ inventory: { Name: "Glycine hydrate", Lot: "ABC", "Extra field": "<original>" }, reviewed: true })],
  };
  const r = makeRecord("buffer", b, "Reviewed");
  saveRecord(r, storage);
  assert.deepEqual(readRecords(storage)[0], r);
  assert.deepEqual(decodeRecord(JSON.stringify(r)), r);
  b.components[0].inventory.Lot = "Changed";
  assert.equal(readRecords(storage)[0].inputs.components[0].inventory.Lot, "ABC");
  const copy = copyRecord(r);
  assert.notEqual(copy.id, r.id);
  assert.equal(copy.status, "Draft");
  assert.equal(copy.inputs.components[0].reviewed, false);
});
test("old rule snapshots survive decoding without silent recalculation", () => {
  const r = makeRecord("sis", demoSIS());
  r.ruleVersion = "legacy";
  r.results.savedMarker = "Keep original";
  const opened = decodeRecord(JSON.stringify(r));
  assert.equal(opened.results.savedMarker, "Keep original");
  assert.equal(opened.ruleVersion, "legacy");
});
test("invalid record and unsafe JSON are rejected; broken browser storage is not overwritten", () => {
  assert.throws(() => decodeRecord("{}"), /supported/);
  assert.throws(() => decodeRecord('{"__proto__":{}}'), /Unsafe/);
  const storage = { getItem: () => "{bad", setItem: () => assert.fail("must not overwrite") };
  assert.throws(() => saveRecord(makeRecord("sis", blankSIS()), storage));
});
test("CSV handles BOM, quoted commas/newlines, retains complete rows and maps search", () => {
  const rows = parseCSV('\uFEFFName,CAS,Barcode,Notes\r\n"Salt, hydrate",123,A1,"one\ntwo"\r\nOther,456,A2,extra');
  const t = tableFromRows(rows);
  assert.equal(t.rows[0].Notes, "one\ntwo");
  assert.equal(t.rows[0].Name, "Salt, hydrate");
  assert.equal(matchingRows(t.rows, { name: "Name", cas: "CAS", barcode: "Barcode" }, "A2")[0].Name, "Other");
  assert.throws(() => parseCSV('Name\n"bad'), /Unclosed/);
});
test("worksheet header row and duplicate/blank columns preserve all fields", () => {
  const t = tableFromRows([["Inventory title"], ["Name", "", "Name"], ["Salt", "extra", "Alias"]], 2);
  assert.deepEqual(t.headers, ["Name", "Column 2", "Name (2)"]);
  assert.equal(t.rows[0]["Name (2)"], "Alias");
});

test("invalid dates and volume conventions cannot pass review", () => {
  assert.ok(calculateSingle(stock({ date: "2026-02-31" })).errors.some((e) => e.includes("date")));
  assert.ok(calculateSingle(stock({ volumeBasis: "unknown" })).errors.some((e) => e.includes("Final Solution")));
  assert.ok(calculateSingle(stock({ volumeMode: "unknown" })).errors.some((e) => e.includes("supported preparation")));
});
test("invalid rules remain missing rather than becoming zero or nonfinite numbers in drafts", () => {
  const s = demoSIS();
  s.minimum = "";
  s.threshold = "abc";
  const r = makeRecord("sis", s);
  assert.equal(r.results.rules.minimumISuL, null);
  assert.equal(r.results.rules.thresholdISuL, null);
  const malformed = makeRecord("sis", demoSIS());
  malformed.inputs.cocktails[0].stocks.S.name = { bad: "data" };
  assert.throws(() => decodeRecord(JSON.stringify(malformed)), /Invalid or missing input field/);
});
