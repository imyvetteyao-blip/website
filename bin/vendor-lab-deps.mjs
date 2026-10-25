import { copyFile, mkdir, readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile(new URL("../node_modules/exceljs/package.json", import.meta.url), "utf8"));
if (pkg.version !== "4.4.0") throw new Error("Review and test a changed ExcelJS version before updating the offline bundle.");
const target = new URL("../assets/js/lab/vendor/", import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(new URL("../node_modules/exceljs/dist/exceljs.min.js", import.meta.url), new URL("exceljs.min.js", target));
await copyFile(new URL("../node_modules/exceljs/LICENSE", import.meta.url), new URL("EXCELJS-LICENSE.txt", target));
console.log("ExcelJS 4.4.0 offline browser bundle and MIT license copied.");
