// Rasterizes public/favicon.svg into the PNG icons the web app manifest needs.
// Run after changing the favicon:  node scripts/gen-icons.mjs
//
// Two shapes, deliberately different:
//  - "any": the rocket on the app's dark background, edge to edge.
//  - "maskable": Android/iOS crop the icon to a circle/squircle, so the artwork
//    is inset to the ~80% safe zone. Without that the fins and flame get clipped.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SRC = fileURLToPath(new URL('../public/favicon.svg', import.meta.url));
const OUT = fileURLToPath(new URL('../public/', import.meta.url));
const BG = '#0b1020'; // matches <meta name="theme-color"> and the boot splash

const svg = readFileSync(SRC);

/** Render at `art` px and pad out to `size` px on the opaque app background. */
async function icon(size, art, name) {
  const pad = Math.round((size - art) / 2);
  const png = await sharp(svg, { density: 384 })
    .resize(art, art, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: pad, bottom: size - art - pad, left: pad, right: size - art - pad, background: BG })
    .flatten({ background: BG })
    .png()
    .toBuffer();
  writeFileSync(OUT + name, png);
  console.log(`${name}  ${size}x${size}`);
}

await icon(192, 192, 'icon-192.png');
await icon(512, 512, 'icon-512.png');
// 80% safe zone: 512 * 0.8 ≈ 410, rounded even.
await icon(512, 410, 'icon-maskable-512.png');
// Apple ignores the manifest and uses this; it is never masked, so no inset.
await icon(180, 180, 'apple-touch-icon.png');
