export const RULE_VERSION = "1.0.0";
// Relative tolerance only for floating-point comparisons at decision boundaries; results stay unrounded.
export const below = (a, b) => a < b && b - a > 16 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), 1);
export const above = (a, b) => below(b, a);
export const RULES = {
  version: RULE_VERSION,
  stockBelowMg: 100,
  minimumISuL: 20,
  thresholdISuL: 100,
  singleStockVolumeLimitUL: 3000,
  volumeBasis: "Final volume includes all stocks and liquids",
};
export function positive(value, label = "Value") {
  if (value === "" || value == null || (typeof value === "string" && !value.trim())) throw new Error(`${label} is required.`);
  if (!["number", "string"].includes(typeof value) || !Number.isFinite(Number(value))) throw new Error(`${label} must be a finite number.`);
  const n = Number(value);
  if (n <= 0) throw new Error(`${label} must be greater than zero.`);
  return n;
}
function finite(n) {
  if (!Number.isFinite(n) || n <= 0) throw new Error("Calculation is outside the supported numeric range.");
  return n;
}
function factor(unit, units) {
  if (!Object.hasOwn(units, unit)) throw new Error(`Unsupported unit: ${unit}.`);
  return units[unit];
}
export const massMg = (v, u) => finite(positive(v, "Mass") * factor(u, { g: 1000, mg: 1, µg: 0.001 }));
export const volumeUL = (v, u) => finite(positive(v, "Volume") * factor(u, { L: 1e6, mL: 1000, µL: 1 }));
export function concentrationMM(v, u, mw) {
  const n = positive(v, "Concentration");
  if (u === "g/L" || u === "mg/mL") return finite((n * 1000) / positive(mw, "Molecular weight"));
  return finite(n * factor(u, { "mol/L": 1000, "mmol/L": 1, "µmol/L": 0.001 }));
}
export function stockFromWeight(mg, mw, ul) {
  return finite((positive(mg, "Mass") / positive(mw, "Molecular weight") / positive(ul, "Preparation volume")) * 1e6);
}
export function stockFromAmount(umol, ul) {
  return finite((positive(umol, "Amount") / positive(ul, "Preparation volume")) * 1000);
}
export function amountFromQNMR(concentration, unit, sampleUL) {
  return finite((concentrationMM(concentration, unit) * positive(sampleUL, "qNMR sample volume")) / 1000);
}
export function requiredBufferMass(targetMM, finalML, mw) {
  return finite((positive(targetMM) * positive(finalML) * positive(mw, "Molecular weight")) / 1000);
}
export const needsStock = (mg) => below(positive(mg), 100);
export function aliquot(targetUM, stockMM, finalUL) {
  return finite((positive(targetUM, "Target concentration") / (positive(stockMM, "Stock concentration") * 1000)) * positive(finalUL, "Final volume"));
}
export function assayMass(targetUM, assayUL, mw) {
  return finite((positive(targetUM) * positive(assayUL) * positive(mw, "Molecular weight")) / 1e6);
}
function attempt(fn) {
  try {
    return fn();
  } catch (e) {
    return { errors: [e.message], warnings: [] };
  }
}
export function calculateSingle(s) {
  return attempt(() => {
    if (!["manual", "target"].includes(s.volumeMode)) throw new Error("Select a supported preparation calculation.");
    if (!["final", "solvent"].includes(s.volumeBasis)) throw new Error("Select Final Solution Volume or Solvent Added.");
    let amount, formula;
    if (s.source === "weight") {
      amount = (massMg(s.mass, s.massUnit) / positive(s.mw, "Molecular weight")) * 1000;
      formula = `Amount (µmol) = ${massMg(s.mass, s.massUnit)} mg / ${s.mw} g/mol × 1000 = ${amount}`;
    } else if (s.source === "qnmr-amount") {
      amount = positive(s.amount, "qNMR amount") * factor(s.amountUnit, { µmol: 1, nmol: 0.001 });
      formula = `qNMR amount = ${amount} µmol (amount, not concentration)`;
    } else if (s.source === "qnmr-concentration") {
      const sampleUL = volumeUL(s.sampleVolume, s.sampleUnit);
      amount = amountFromQNMR(s.qConcentration, s.qUnit, sampleUL);
      formula = `Amount (µmol) = ${concentrationMM(s.qConcentration, s.qUnit)} mM × ${sampleUL} µL / 1000 = ${amount}`;
    } else throw new Error("Select a supported stock data source.");
    const prepUL =
      s.volumeMode === "target"
        ? finite((amount * 1000) / concentrationMM(s.desiredConcentration, s.desiredUnit))
        : volumeUL(s.prepVolume, s.prepUnit);
    const stockMM = stockFromAmount(amount, prepUL);
    const errors = [],
      warnings = [];
    if (prepUL >= 3000) errors.push("Single-standard preparation volume must be <3000 µL.");
    const availableUL = s.available === "" || s.available == null ? prepUL : volumeUL(s.available, s.availableUnit);
    if (above(availableUL, prepUL)) errors.push("Available stock volume cannot exceed prepared volume.");
    if (s.volumeBasis === "solvent")
      warnings.push("Volume approximation: concentration uses solvent added as an approximation of final solution volume.");
    if (!s.name?.trim()) errors.push("Compound name is required.");
    if (!s.lot?.trim()) errors.push("Lot is required.");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(s.date || "") ||
      !Number.isFinite(Date.parse(s.date)) ||
      (Number.isFinite(Date.parse(s.date)) && new Date(s.date).toISOString().slice(0, 10) !== s.date)
    )
      errors.push("Preparation date is required.");
    if (!s.solvent?.trim()) errors.push("Solvent is required.");
    if (s.mw !== "" && s.mw != null) positive(s.mw, "Molecular weight");
    return {
      amountUmol: amount,
      prepUL,
      stockMM,
      availableUL,
      errors,
      warnings,
      formulas: [
        formula,
        `Stock concentration (mM) = ${amount} µmol / ${prepUL} µL × 1000 = ${stockMM}`,
        ...(s.volumeMode === "target" ? [`Preparation volume (µL) = ${amount} µmol × 1000 / ${stockMM} mM = ${prepUL}`] : []),
      ],
    };
  });
}
export function coordinateVolumes(batches, minimum = 20, threshold = 100, match = false) {
  const min = positive(minimum, "Minimum IS aliquot"),
    limit = positive(threshold, "IS scale-up threshold");
  if (min < 20) throw new Error("Minimum IS Aliquot must be ≥20 µL.");
  if (!batches.length) throw new Error("Add at least one cocktail.");
  const rows = batches.map((b) => {
    const original = positive(b.volume, "Original volume"),
      stock = positive(b.stockMM, "IS stock concentration"),
      target = positive(b.targetUM, "IS target concentration");
    return { ...b, original, originalIS: aliquot(target, stock, original), minimumVolume: finite((min * stock * 1000) / target) };
  });
  const same = rows.every((r) => r.original === rows[0].original);
  const deficient = rows.some((r) => below(r.originalIS, min));
  const common = Math.max(...rows.map((r) => Math.max(r.original, r.minimumVolume)));
  return rows.map((r) => {
    let selected = r.original,
      reason = "Original volume retained: minimum IS aliquot already satisfied.";
    const proposed = (same && deficient) || match ? common : r.original;
    const proposedIS = aliquot(r.targetUM, r.stockMM, proposed);
    if (!same && !match) reason = "Different original volumes: use Match Batch Volumes to preview an explicit plan.";
    else if ((same && deficient) || match) {
      if (!above(proposedIS, limit)) {
        selected = proposed;
        reason =
          selected === r.original ? "Original volume already matches the common volume." : "Common volume adopted to meet the minimum IS aliquot.";
      } else if (!below(r.originalIS, min)) reason = `Original volume retained: scaled IS aliquot would exceed ${limit} µL.`;
      else {
        selected = Math.max(r.original, r.minimumVolume);
        reason = "Scaled to the minimum required volume to satisfy the IS minimum.";
      }
    }
    return {
      id: r.id,
      originalVolume: r.original,
      proposedVolume: proposed,
      selectedVolume: selected,
      originalIS: r.originalIS,
      finalIS: aliquot(r.targetUM, r.stockMM, selected),
      reason,
    };
  });
}
export function calculateCocktail(c, selectedVolume) {
  return attempt(() => {
    const finalUL = positive(selectedVolume, "Final cocktail volume"),
      assayUL = volumeUL(c.assayVolume, c.assayUnit),
      errors = [],
      warnings = [],
      rows = [];
    if (assayUL > finalUL) errors.push("Cocktail volume per assay exceeds the final cocktail volume.");
    for (const role of ["S", "IS"]) {
      const s = c.stocks[role],
        stock = calculateSingle(s);
      errors.push(...stock.errors.map((e) => `${role}: ${e}`));
      warnings.push(...stock.warnings.map((e) => `${role}: ${e}`));
      const targetUM = concentrationMM(s.target, s.targetUnit) * 1000;
      if (!stock.stockMM) {
        rows.push({ role, name: s.name, stock, targetUM });
        continue;
      }
      const transferUL = aliquot(targetUM, stock.stockMM, finalUL),
        perAssayUL = aliquot(targetUM, stock.stockMM, assayUL);
      const massUG = s.mw === "" || s.mw == null ? null : assayMass(targetUM, assayUL, s.mw);
      if (above(transferUL, stock.availableUL)) errors.push(`${role}: required stock volume exceeds available volume (${stock.availableUL} µL).`);
      rows.push({
        role,
        name: s.name,
        stock,
        targetUM,
        transferUL,
        perAssayUL,
        massUG,
        formulas: [
          `Stock volume per assay = ${targetUM} µM / (${stock.stockMM} mM × 1000) × ${assayUL} µL = ${perAssayUL} µL`,
          `Stock volume to transfer = ${targetUM} µM / (${stock.stockMM} mM × 1000) × ${finalUL} µL = ${transferUL} µL`,
          massUG == null
            ? "Compound mass per assay: Missing MW."
            : `Compound mass per assay = ${targetUM} µM × ${assayUL} µL × ${s.mw} g/mol / 1000000 = ${massUG} µg`,
        ],
      });
    }
    const complete = rows.every((r) => r.transferUL != null);
    const solventUL = complete ? finalUL - rows.reduce((sum, r) => sum + r.transferUL, 0) : null;
    if (solventUL != null && below(solventUL, 0)) errors.push("Stock transfer volumes exceed final cocktail volume. Solvent volume is negative.");
    return {
      finalUL,
      assayUL,
      rows,
      solventUL,
      errors,
      warnings,
      formulas: solventUL == null ? [] : [`Solvent volume = ${finalUL} − (${rows.map((r) => r.transferUL).join(" + ")}) = ${solventUL} µL`],
    };
  });
}
export function calculateBufferComponent(c, volume, unit) {
  return attempt(() => {
    const mw = positive(c.mw, "Molecular weight"),
      finalML = volumeUL(volume, unit) / 1000;
    const targetMM = concentrationMM(c.target, c.targetUnit, mw),
      requiredMg = requiredBufferMass(targetMM, finalML, mw);
    const errors = [],
      warnings = [];
    if (!["solid", "pure-liquid", "solution"].includes(c.form)) throw new Error("Physical form is required; do not infer it from the compound name.");
    const density = c.form === "pure-liquid" ? positive(c.density, "Density (g/mL)") : null;
    let stockMM = null,
      transferML = null,
      actualMM = null,
      liquidML = 0;
    const forcedStock = needsStock(requiredMg),
      method = c.form === "solution" ? "existing" : forcedStock && c.method === "direct" ? "new" : c.method;
    const formulas = [`Required mass (mg) = ${targetMM} mM × ${finalML} mL × ${mw} g/mol / 1000 = ${requiredMg}`];
    try {
      if (method === "direct") {
        if (c.form === "solid") actualMM = (massMg(c.actualMass, c.massUnit) * 1000) / (mw * finalML);
        else {
          liquidML = volumeUL(c.actualLiquid, c.liquidUnit) / 1000;
          actualMM = (liquidML * density * 1e6) / (mw * finalML);
        }
        formulas.push(`Actual concentration = actual mass (mg) × 1000 / (${mw} × ${finalML}) = ${actualMM} mM`);
      } else {
        if (method === "new") stockMM = stockFromWeight(massMg(c.actualMass, c.massUnit), mw, volumeUL(c.stockVolume, c.stockVolumeUnit));
        else if (method === "existing") {
          stockMM = concentrationMM(c.knownConcentration, c.knownUnit, mw);
          if (!c.confirmed) errors.push("Confirm the existing stock concentration.");
        } else throw new Error("Select a preparation method.");
        transferML = finite((targetMM / stockMM) * finalML);
        if (transferML > finalML) errors.push("Stock transfer volume exceeds final buffer volume.");
        formulas.push(
          method === "new"
            ? `Stock concentration = ${massMg(c.actualMass, c.massUnit)} mg × 1000 / (${mw} × ${volumeUL(c.stockVolume, c.stockVolumeUnit) / 1000} mL) = ${stockMM} mM`
            : `Confirmed stock concentration = ${stockMM} mM`
        );
        formulas.push(`Stock transfer volume = ${targetMM} / ${stockMM} × ${finalML} = ${transferML} mL`);
        const availableML = method === "new" ? volumeUL(c.stockVolume, c.stockVolumeUnit) / 1000 : volumeUL(c.available, c.availableUnit) / 1000;
        if (above(transferML, availableML)) errors.push("Required stock volume exceeds available volume.");
        liquidML = volumeUL(c.actualTransfer, c.transferUnit) / 1000;
        if (above(liquidML, availableML)) errors.push("Actual transfer exceeds available stock volume.");
        actualMM = (stockMM * liquidML) / finalML;
        formulas.push(`Actual final concentration = ${stockMM} × ${liquidML} / ${finalML} = ${actualMM} mM`);
      }
    } catch (e) {
      errors.push(e.message);
    }
    if (actualMM != null && (!Number.isFinite(actualMM) || actualMM <= 0))
      throw new Error("Actual concentration is outside the supported numeric range.");
    if (liquidML > finalML) errors.push("Actual liquid volume exceeds final buffer volume.");
    return {
      requiredMg,
      forcedStock,
      method,
      targetMM,
      stockMM,
      transferML,
      actualMM,
      liquidML,
      requiredLiquidUL: density ? requiredMg / density : null,
      errors,
      warnings,
      formulas,
    };
  });
}
export function calculateBuffer(b) {
  const errors = [],
    rows = b.components.map((c) => ({ id: c.id, ...calculateBufferComponent(c, b.volume, b.volumeUnit) }));
  if (!b.name?.trim()) errors.push("Preparation name is required.");
  if (!rows.length) errors.push("Add at least one inventory component.");
  try {
    positive(b.volume, "Final buffer volume");
    volumeUL(b.volume, b.volumeUnit);
  } catch (e) {
    errors.push(e.message);
  }
  rows.forEach((r, i) => errors.push(...r.errors.map((e) => `Component ${i + 1}: ${e}`)));
  const liquidML = rows.every((r) => r.liquidML != null) ? rows.reduce((a, r) => a + r.liquidML, 0) : null;
  try {
    if (liquidML != null && liquidML > volumeUL(b.volume, b.volumeUnit) / 1000) errors.push("Combined liquid additions exceed final buffer volume.");
  } catch {
    /* Volume error is reported above. */
  }
  return { rows, liquidML, errors, warnings: [], rules: RULES };
}
function validPositiveOrNull(value) {
  try {
    return positive(value);
  } catch {
    return null;
  }
}
export function calculateSIS(s) {
  const errors = [],
    warnings = [];
  if (!s.name?.trim()) errors.push("Preparation name is required.");
  let plan = [];
  try {
    plan = coordinateVolumes(
      s.cocktails.map((c) => ({
        id: c.id,
        volume: volumeUL(c.volume, c.volumeUnit),
        stockMM: calculateSingle(c.stocks.IS).stockMM,
        targetUM: concentrationMM(c.stocks.IS.target, c.stocks.IS.targetUnit) * 1000,
      })),
      s.minimum,
      s.threshold,
      s.match
    );
  } catch (e) {
    errors.push(e.message);
  }
  const cocktails = s.cocktails.map((c) => {
    const p = plan.find((r) => r.id === c.id);
    const result = calculateCocktail(c, p?.selectedVolume);
    if (!c.name?.trim()) errors.push("Cocktail name is required.");
    errors.push(...result.errors.map((e) => `${c.name || "Cocktail"}: ${e}`));
    if (p && below(p.finalIS, Number(s.minimum))) errors.push(`${c.name}: IS aliquot is below ${s.minimum} µL.`);
    return { id: c.id, name: c.name, plan: p, ...result };
  });
  if (plan.length && new Set(plan.map((p) => p.selectedVolume)).size > 1)
    warnings.push("Different final volumes: follow the selected final volume for each cocktail.");
  if (!s.confirmed) errors.push("Confirm the volume plan before generating a reviewed operation sheet.");
  return {
    cocktails,
    plan,
    errors,
    warnings,
    rules: { ...RULES, minimumISuL: validPositiveOrNull(s.minimum), thresholdISuL: validPositiveOrNull(s.threshold) },
  };
}
