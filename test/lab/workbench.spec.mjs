import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";

const field = (page, path) => page.locator(`[data-path="${path}"]`);
async function demo(page) {
  await page.goto("#sis");
  await page.getByRole("button", { name: "Load A / B / C demo" }).click();
}

test("home has three honest entry points and a desktop layout without overflow", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Buffer Making", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "S/IS Making", exact: true })).toBeVisible();
  await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
  await expect(page.getByText("No company system or backend is connected.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "output/playwright/lab/home-desktop.png", fullPage: true });
});
test("A/B/C plan, confirmation, review, save/reopen, full record JSON and edit invalidation", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await demo(page);
  const rows = page.locator(".plan-table tbody tr");
  await expect(rows).toHaveCount(3);
  for (const [i, v] of ["1,200", "600", "1,200"].entries()) await expect(rows.nth(i).locator("td").nth(3)).toHaveText(v);
  await expect(rows.nth(1)).toContainText("Original volume retained: scaled IS aliquot would exceed 100 µL.");
  await expect(page.getByRole("button", { name: "Mark Reviewed", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Confirm volume plan", exact: true }).click();
  await page.getByRole("button", { name: "Mark Reviewed", exact: true }).click();
  await page.getByRole("button", { name: "Save Preparation Record", exact: true }).first().click();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("lab-preparation-workbench.records.v1"))[0]);
  expect(before.status).toBe("Reviewed");
  before.results.plan.forEach((p, i) => expect(p.selectedVolume).toBeCloseTo([1200, 600, 1200][i], 9));
  expect(before.demo).toBe(true);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^demo-sis/);
  await page.reload();
  await page.getByRole("link", { name: "Records", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(field(page, "name")).toHaveValue(before.inputs.name);
  await expect(page.getByText("Saved record reopened.", { exact: true })).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("lab-preparation-workbench.records.v1"))[0]);
  expect(after).toEqual(before);
  await field(page, "cocktails.0.stocks.S.target").fill("110");
  await expect(page.getByRole("button", { name: "Confirm volume plan", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark Reviewed", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save Preparation Record", exact: true }).first().click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("lab-preparation-workbench.records.v1"))[0].status)).toBe("Draft");
  expect(errors).toEqual([]);
});
test("full cocktail table headers, missing MW behavior and printable sheets", async ({ page }) => {
  await demo(page);
  await page.getByRole("button", { name: "Confirm volume plan", exact: true }).click();
  const headers = page.locator(".workspace .results-table").first().locator("th");
  await expect(headers).toHaveCount(6);
  for (const h of await headers.all()) {
    expect(await h.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await expect(h).toBeVisible();
  }
  await field(page, "cocktails.0.stocks.S.mw").fill("");
  await expect(page.locator(".workspace .results-table").first().locator("tbody tr").first()).toContainText("Missing MW");
  await expect(page.locator(".workspace .results-table").first().locator("tbody tr").first().locator("td").last()).toHaveText("120");
  await page.getByRole("button", { name: "Confirm volume plan", exact: true }).click();
  await page.screenshot({ path: "output/playwright/lab/sis-desktop.png", fullPage: true });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".operation")).toBeVisible();
  await expect(page.locator(".workspace")).toBeHidden();
  await expect(page.locator(".operation")).toContainText("Demo data");
  await expect(page.locator(".operation")).toContainText("Final Cocktail Volume: 1,200 µL");
  await page.pdf({ path: "output/playwright/lab/demo-operation-sheet.pdf", format: "A4", landscape: true, printBackground: true });
});
test("CSV import, full inventory snapshots, two independent components and reviewed invalidation", async ({ page }) => {
  await page.goto("#buffer");
  await field(page, "name").fill("Test buffer");
  await field(page, "volume").fill("1000");
  await page.locator("#inventory-file").setInputFiles({
    name: "inventory.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Name,CAS,Barcode,MW,Lot,Extra\nGlycine hydrate,56-40-6,G1,100,LOT-A,Keep this field\nSalt hydrate,123,S2,100,LOT-B,Keep second field"
    ),
  });
  await expect(page.getByText("2 entries", { exact: true })).toBeVisible();
  await page.locator("#inventory-query").fill("G1");
  await page.getByRole("button", { name: "Add component", exact: true }).click();
  await field(page, "components.0.form").selectOption("solid");
  await field(page, "components.0.target").fill("1");
  await field(page, "components.0.actualMass").fill("101");
  await expect(page.getByText("Stock required.", { exact: true })).toHaveCount(0);
  await field(page, "components.0.reviewed").check();
  await page.locator("#inventory-query").fill("S2");
  await page.getByRole("button", { name: "Add component", exact: true }).click();
  await expect(field(page, "components.0.mw")).toHaveValue("100");
  await expect(field(page, "components.0.reviewed")).not.toBeChecked();
  await expect(page.locator(".snapshot").first()).toContainText("Keep this field");
  await expect(page.locator(".snapshot").nth(1)).toContainText("Keep second field");
  await field(page, "components.1.form").selectOption("solid");
  await field(page, "components.1.target").fill(".5");
  await expect(page.getByText("Stock required.", { exact: true })).toBeVisible();
  expect(await field(page, "components.1.method").locator("option[value=direct]").count()).toBe(0);
  await field(page, "components.1.actualMass").fill("50");
  await field(page, "components.1.stockVolume").fill("100");
  await field(page, "components.1.actualTransfer").fill("100");
  await field(page, "components.0.reviewed").check();
  await field(page, "components.1.reviewed").check();
  await page.getByRole("button", { name: "Mark Reviewed", exact: true }).click();
  await page.getByRole("button", { name: "Save Preparation Record", exact: true }).first().click();
  const r = await page.evaluate(() => JSON.parse(localStorage.getItem("lab-preparation-workbench.records.v1"))[0]);
  expect(r.status).toBe("Reviewed");
  expect(r.inputs.components[0].inventory.Extra).toBe("Keep this field");
  expect(r.inputs.components).toHaveLength(2);
  expect(r.inputs.components[1].method).toBe("new");
  expect(r.demo).toBe(false);
  await page.screenshot({ path: "output/playwright/lab/buffer-desktop.png", fullPage: true });
});
test("XLSX worksheets and custom header rows retain all source fields without evaluating formulas", async ({ page }) => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Instructions").addRow(["Reference only"]);
  const sheet = book.addWorksheet("Chemicals");
  sheet.addRow(["Inventory title"]);
  sheet.addRow(["Chemical ID", "CAS no.", "Code", "MW", "Custom field"]);
  sheet.addRow(["Exact salt hydrate", "123-45-6", "ABC", 210.1, "Full row value"]);
  await page.goto("#buffer");
  await page.locator("#inventory-file").setInputFiles({
    name: "chemicals.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  });
  await page.locator("#sheet-index").selectOption("1");
  await page.locator("#header-row").fill("2");
  await page.locator("#header-row").dispatchEvent("change");
  await page.locator("#map-name").selectOption("Chemical ID");
  await page.locator("#map-barcode").selectOption("Code");
  await page.locator("#inventory-query").fill("ABC");
  await expect(page.getByText("Full row value", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add component", exact: true }).click();
  await expect(field(page, "components.0.mw")).toHaveValue("210.1");
  await expect(field(page, "components.0.form")).toHaveValue("");
  await expect(page.locator(".snapshot")).toContainText("Full row value");
});
test("JSON import is Draft, snapshot preserved, duplication gets a fresh identity", async ({ page }) => {
  await demo(page);
  await page.getByRole("button", { name: "Save Preparation Record", exact: true }).first().click();
  const r = await page.evaluate(() => JSON.parse(localStorage.getItem("lab-preparation-workbench.records.v1"))[0]);
  await page.getByRole("link", { name: "Records", exact: true }).click();
  await page.locator("#record-file").setInputFiles({ name: "record.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(r)) });
  await expect(page.getByText("2 records", { exact: true })).toBeVisible();
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem("lab-preparation-workbench.records.v1")));
  expect(rows[0].id).not.toBe(r.id);
  expect(rows[0].status).toBe("Draft");
  expect(rows[0].results).toEqual(r.results);
  await page.getByRole("button", { name: "Copy as new", exact: true }).first().click();
  await expect(field(page, "name")).toHaveValue(`${r.name} (copy)`);
  await expect(page.getByRole("button", { name: "Confirm volume plan", exact: true })).toBeVisible();
});
test("mobile shell stays within viewport and data tables scroll horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expect(page.getByRole("button", { name: "Confirm volume plan", exact: true })).toBeVisible();
  await page.screenshot({ path: "output/playwright/lab/sis-mobile.png", fullPage: true });
});
