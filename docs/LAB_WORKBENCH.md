# Lab Preparation Workbench

A browser-local laboratory preparation app built on this repository's existing Jekyll and JavaScript stack. The workbench is the site homepage; the original academic about page is retained at `/about/`. All app labels, errors, records, and print sheets are in English. No backend, account, or company-system integration is implied.

## Run locally

Prerequisites: Ruby 3.3, Bundler 4.0.6, Node.js 20+ (Node 24 is tested), and the dependencies in the existing Gemfile. The surrounding example Jekyll site also uses ImageMagick and Python `nbconvert`; the workbench itself does not call Python or external services.

```bash
cd /workspace/website
# In this prepared cloud environment, activate its retained local tools:
source /workspace/.setup/activate
bundle install
npm ci
bundle exec jekyll serve --config _config.yml,_config.lab.yml --host 127.0.0.1 --port 4173
```

On another machine with Ruby/Bundler on PATH, omit the activation line. Keep the repository's `/al-folio` base path. Open the server's `/al-folio/` path in your local browser. The cloud onboarding UI does not provide loopback previews. For a build without a running server:

```bash
bundle exec jekyll build --config _config.yml,_config.lab.yml
```

`_config.lab.yml` preserves the main site's settings, disables unrelated external demo-post imports, and excludes the Twitter demo page and development tooling. The original full-site production build still depends on access to external content. Citation widgets on legacy pages may log nonfatal network warnings. The workbench itself loads its scripts, styles, and XLSX reader locally and needs no external runtime requests.

## Use the workbench

- **Buffer Making:** name the recipe and enter a shared final volume. Import CSV/TSV or XLSX, select a worksheet/header row, and map name, CAS, barcode, optional MW, and optional density columns. Search a mapped field and add an inventory entry. Each added component keeps its complete inventory row and source as a separate snapshot. Verify exact salt/hydrate MW, select physical form explicitly, set the concentration, and enter actual preparation measurements. Below 100 mg, new or confirmed existing stock is mandatory; exactly 100 mg permits direct preparation. Existing solutions use their confirmed concentration, while pure liquids use density in g/mL. Check each component's Calculation Review after resolving errors.
- **S/IS Making:** enter each cocktail's original planned volume and volume per assay. Each independent S and IS standard records its own compound, optional MW for qNMR, lot, preparation date, solvent, stock source, preparation volume, availability, and target cocktail concentration. Default preparation uses a manually entered final solution volume; target-concentration mode instead solves for volume. Solvent-added mode explicitly labels the volume approximation. qNMR amount and concentration are distinct inputs; concentration requires its original sample volume.
- Inspect the batch volume plan. Equal original volumes coordinate automatically when an IS is below the minimum; differing originals need **Match Batch Volumes** to preview coordination. A batch already meeting the minimum keeps its original volume if following the common volume would exceed the scale-up threshold. The threshold is not an IS usage cap. Confirm the plan before printing an S/IS operation sheet. Any preparation input change resets the plan and review.
- **Save Preparation Record** supports incomplete Drafts and validated Reviewed records. **Records** reopens, duplicates, imports, exports, or deletes local records. Changes to an opened preparation require review again. Duplicate records get new identities and Draft status. Import creates a new Draft with the original result snapshot retained.
- Use browser print / Save as PDF for a clean operation sheet. Draft sheets identify unresolved errors. S/IS sheets require a confirmed volume plan. Different final volumes and adjustment reasons appear as text, not only color.
- **Other Preparation:** Coming soon.

### Storage and provenance

Records and imported inventory exist only in localStorage on the current browser origin. Changing the hostname/port, clearing browser data, using private browsing, or reaching the browser's storage quota can affect availability. Save explicitly before leaving; export JSON for backup or transfer. Storage failures are reported rather than shown as successful saves.

Saved JSON includes input units, precise calculated results, rule version, stock lots/dates, volume decisions/reasons, and selected inventory row snapshots. Existing results are preserved on reopen. A record with another rule version opens read-only until explicit recalculation. Imports are never independent evidence of review. Demo inventory and the A/B/C example remain labeled **Demo data** in editor, records, JSON, and print sheets.

### Calculation conventions

Internal units are mg, µL (buffer formulas use mL), mM, and µmol. Calculations keep IEEE-754 double precision; presentation rounds only at the output boundary. Decision comparisons allow 16 machine epsilons of relative error to avoid floating-point artifacts at mathematically equal thresholds. Every result includes an expandable formula with substituted values. Missing and invalid values produce explicit validation; missing MW in qNMR permits volume calculations and displays **Missing MW** for mass.

The only buffer volume convention is final volume including all stock and liquid additions. Added-on-top stock volume is intentionally not supported. Supported concentration units are mol/L, mmol/L, µmol/L, g/L, and mg/mL for buffer recipes; molar units for S/IS. Percent solutions and other undefined concentration conventions are rejected. No purity correction is performed in S/IS.

The provided spreadsheets were reviewed as formula references; their ambiguous qNMR headings, historical targets, and incomplete formulas are not copied into business logic. No source laboratory data is seeded as real inventory or records. No interface concept image was attached to this task; styling follows the requested white, navy, and teal direction.

## Tests

```bash
npm run test:lab
npm run lint:style-contract
npm run lint:prettier
# With the Jekyll server running on port 4173:
LAB_CHROMIUM_PATH=/usr/bin/chromium npm run test:lab:browser
```

If Chromium is not installed locally, run `npx playwright install chromium` and omit `LAB_CHROMIUM_PATH`. `LAB_BASE_URL` can select another server URL including its base path. Browser tests use a fresh browser context and never production records.

Independent Node tests cover mass/volume/concentration conversion, qNMR, manual/target stock preparation, <3000 µL, buffer <100/=100 mg, pure liquid versus solution, combined liquid overflow, per-assay and total transfers, missing MW, IS boundary conditions, threshold =100/>100, the A/B/C case, differing originals, stock shortages, negative solvent, malformed input, CSV structure, and JSON/localStorage round trips. Browser tests exercise actual CSV/XLSX import and mapping, independent components, review invalidation, save/reopen, copy/import/export, desktop headers, mobile overflow, and print media/PDF output.

Screenshots, test traces on failure, and a demo PDF go to ignored `output/playwright/lab/`.

### Validation performed

On 2026-10-25 in the prepared Linux environment: 32 independent calculation/storage/parser tests and 7 Chromium browser tests passed. The Jekyll build, full Prettier check, style-contract check, and clean npm lockfile installation passed. Desktop table headers and units were inspected, and print-media rendering produced a demo PDF. Both supplied XLSX reference files were also opened with the actual browser importer and their worksheet lists verified. These reference workbooks are not seeded as inventory records. No public deployment was performed.

## Code map and limitations

- `_pages/lab.html`: standalone Jekyll homepage.
- `assets/js/lab/calculations.mjs`: pure calculations and validation.
- `assets/js/lab/models.mjs`: models, snapshots, rules, record persistence.
- `assets/js/lab/inventory.mjs`: CSV/TSV parsing, worksheet extraction, mapping/search.
- `assets/js/lab/app.mjs`: UI, workflow, and print rendering.
- `assets/css/lab-workbench.css`: responsive and print styles.
- `test/lab/`: independent and browser tests.

ExcelJS 4.4.0 (MIT) is pinned and its browser bundle is included locally with its license. `npm run vendor:lab` reproducibly refreshes the checked-in bundle from the locked npm dependency; no CDN is required. Spreadsheet formulas/macros are not executed; cached formula values are read when present, otherwise the formula is retained as text and cannot pass numeric validation. CSV/TSV and XLSX are supported, not legacy XLS. Import limits are 10 MB, 50,000 rows, and 500 columns; JSON records are limited to 12 MB. Search displays the first 30 matches and asks the user to refine larger results.

Availability is checked against each independently defined stock preparation; this version does not manage shared physical stock-vial depletion across separate records or cocktails. Browser storage provides no multi-user audit trail, access control, electronic signature, or centralized backup. Public deployment was not requested or performed.
