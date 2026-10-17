// Prints sheet.html to ../AstraRocket-Onshape.pdf, a one-page 16:9 sheet.
// Uses the Playwright Chromium that web/ installs. From the repository root:
//   node design/onshape-sheet/build.mjs
//
// The images: menu.png is the File menu open on Export -> JSON, captured at 3x
// pixel density; left.png and right.png are the 3D view's Image export (8K) of
// the parallel-booster-staging and pods-airframes-and-winglets examples,
// cropped below the caption block, trimmed and turned nose up.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const html = fileURLToPath(new URL('./sheet.html', import.meta.url));
const pdf = fileURLToPath(new URL('../AstraRocket-Onshape.pdf', import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(pathToFileURL(html).href);
await page.waitForLoadState('load');
await page.pdf({ path: pdf, width: '13.333in', height: '7.5in', printBackground: true });
await browser.close();
console.log(pdf);
