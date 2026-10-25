# Open Lab Preparation Workbench

This folder contains a self-contained version of the application. All scripts, styles, and the XLSX reader are embedded in one HTML file; Ruby, Node.js, and Python are not needed to use it.

1. Open `Lab-Preparation-Workbench.html` on GitHub.
2. Click **Download raw file** in the file toolbar (the down-arrow button). Do not save the GitHub file-viewing page itself.
3. Open the downloaded `.html` file in a current desktop Chrome, Edge, or Firefox browser with JavaScript enabled.

Alternatively, use the repository's **Code → Download ZIP**, extract it, and open `standalone/Lab-Preparation-Workbench.html`.

Records are stored only in that browser. Keep the same file path and browser to reopen them, and export JSON backups. Local-file storage behavior varies by browser. Organization-managed browsers may block local HTML files; if yours does, use the HTTP server instructions in [the development guide](../docs/LAB_WORKBENCH.md). No website deployment is needed.

The ExcelJS 4.4.0 browser bundle is MIT licensed; its license is included in [the source tree](../assets/js/lab/vendor/EXCELJS-LICENSE.txt).

Developers can regenerate this file with `npm ci` followed by `npm run build:lab:standalone`. Do not edit the generated HTML directly.
