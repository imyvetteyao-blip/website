export function parseCSV(text) {
  const input = text.replace(/^\uFEFF/, "");
  const firstLine = input.split(/\r?\n/)[0];
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field === "") quoted = !quoted;
      else throw new Error("Invalid quote in CSV.");
    } else if (ch === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}
export function tableFromRows(rows, headerRow = 1) {
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > rows.length) throw new Error("Choose a valid header row.");
  if (rows.length > 50000) throw new Error("Inventory exceeds 50,000 rows.");
  const width = Math.max(...rows.map((r) => r.length));
  if (width > 500 || rows.length > 50000) throw new Error("Inventory exceeds 50,000 rows or 500 columns.");
  const seen = new Map();
  const headers = Array.from({ length: width }, (_, i) => {
    const raw = String(rows[headerRow - 1][i] ?? "").trim() || `Column ${i + 1}`,
      n = (seen.get(raw) || 0) + 1;
    seen.set(raw, n);
    return n === 1 ? raw : `${raw} (${n})`;
  });
  return {
    headers,
    rows: rows
      .slice(headerRow)
      .filter((r) => r.some((v) => v !== "" && v != null))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))),
  };
}
export async function readInventoryFile(file) {
  if (file.size > 10e6) throw new Error("Inventory file exceeds 10 MB.");
  if (/\.(csv|tsv)$/i.test(file.name)) return [{ name: "CSV", rows: parseCSV(await file.text()) }];
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Select a CSV, TSV, or XLSX file. Legacy XLS is not supported.");
  if (!globalThis.ExcelJS) throw new Error("XLSX reader is unavailable. Reload the page or use CSV.");
  const workbook = new globalThis.ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return workbook.worksheets.map((sheet) => {
    if (sheet.rowCount > 50000 || sheet.columnCount > 500) throw new Error("Worksheet exceeds 50,000 rows or 500 columns.");
    const rows = [];
    for (let n = 1; n <= sheet.rowCount; n++) {
      const row = [];
      for (let i = 1; i <= sheet.columnCount; i++) {
        const cell = sheet.getRow(n).getCell(i),
          v = cell.value;
        row.push(
          v == null
            ? ""
            : v instanceof Date
              ? v.toISOString()
              : typeof v !== "object"
                ? v
                : v.formula || v.sharedFormula
                  ? (v.result ?? `=${v.formula || v.sharedFormula}`)
                  : v.richText
                    ? v.richText.map((t) => t.text).join("")
                    : (v.text ?? JSON.stringify(v))
        );
      }
      rows.push(row);
    }
    return { name: sheet.name, rows };
  });
}
export function suggestMapping(headers) {
  const find = (names) => headers.find((h) => names.includes(h.toLowerCase().trim())) || "";
  return {
    name: find(["name", "chemical", "compound", "chemical name", "reagent"]),
    cas: find(["cas", "cas number", "cas no.", "cas #"]),
    barcode: find(["barcode", "bar code", "id"]),
    mw: find(["mw", "molecular weight", "mw (g/mol)"]),
    density: find(["density", "density (g/ml)"]),
  };
}
export function matchingRows(rows, mapping, query) {
  const q = query.toLocaleLowerCase().trim();
  if (!q) return [];
  return rows.filter((r) =>
    ["name", "cas", "barcode"].some(
      (k) =>
        mapping[k] &&
        String(r[mapping[k]] ?? "")
          .toLocaleLowerCase()
          .includes(q)
    )
  );
}
