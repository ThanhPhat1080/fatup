// Draws the PWA's full-bleed icons from the same gradient and arrow as desktop/build/icon.svg:
//   web/public/icon-maskable-192.png, icon-maskable-512.png  (Android masks these into a circle, squircle, ...)
//   web/public/apple-touch-icon.png                          (iOS rounds the corners itself and paints transparency black)
// The rounded-square icon-192.png / icon-512.png ("any") are left as they are.
// Run: node web/scripts/pwa-icons.mjs   (needs `sharp`, which is already in node_modules)
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * A square filled edge to edge with the gradient, the arrow in the middle. Maskable icons keep their content inside the central
 * circle of 80% of the width (the "safe zone"); this arrow, scaled by SCALE, reaches about 30% from the centre.
 */
const SCALE = 1.05;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4285f4"/>
      <stop offset="1" stop-color="#34a853"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <g transform="translate(512 512) scale(${SCALE}) translate(-512 -512)">
    <path d="M512 262 L512 762 M312 462 L512 262 L712 462" fill="none" stroke="#fff" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

for (const [name, size] of [
  ['icon-maskable-512.png', 512],
  ['icon-maskable-192.png', 192],
  ['apple-touch-icon.png', 180],
]) {
  await writeFile(join(out, name), await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
  console.log('wrote', name);
}
