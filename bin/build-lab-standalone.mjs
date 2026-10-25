import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const { outputFiles } = await build({
  entryPoints: [new URL("assets/js/lab/app.mjs", root).pathname],
  bundle: true,
  format: "iife",
  target: "es2022",
  write: false,
});
const css = await readFile(new URL("assets/css/lab-workbench.css", root), "utf8");
const vendor = await readFile(new URL("assets/js/lab/vendor/exceljs.min.js", root), "utf8");
const safe = (text) => text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lab Preparation Workbench</title><link rel="icon" href="data:,"><style>${css}</style></head><body>
<a class="skip-link" href="#main">Skip to workbench</a><div id="app"></div><div id="toast" class="toast" role="status" aria-live="polite"></div><noscript>This workbench requires JavaScript.</noscript>
<script>${safe(vendor)}</script><script>${safe(outputFiles[0].text)}</script></body></html>`;
await mkdir(new URL("standalone/", root), { recursive: true });
await writeFile(new URL("standalone/Lab-Preparation-Workbench.html", root), html);
console.log("Built standalone/Lab-Preparation-Workbench.html with all scripts and styles embedded.");
