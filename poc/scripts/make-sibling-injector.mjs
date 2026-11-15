// Writes a page-side script that appends the sheets read from <dir>/sheet-<module>.css to the page as constructable stylesheets (allowed under the page's
// style-src 'self', unlike a <style> element or a cross-origin link). Usage: node make-sibling-injector.mjs <dir> <out.js> <module...>
import fs from 'node:fs';
import path from 'node:path';
const [dir, out, ...modules] = process.argv.slice(2);
if (!dir || !out || modules.length === 0) throw new Error('Usage: node make-sibling-injector.mjs <dir> <out.js> <module...>');
const sheets = modules.map((name) => fs.readFileSync(path.join(dir, `sheet-${name}.css`), 'utf8'));
fs.writeFileSync(out, `(() => { const sheets = ${JSON.stringify(sheets)}; document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...sheets.map((text) => { const sheet = new CSSStyleSheet(); sheet.replaceSync(text); return sheet; })]; return 'adopted ' + sheets.length; })()`);
