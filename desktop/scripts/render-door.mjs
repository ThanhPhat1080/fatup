// Renders the simple lock door to two WebP images, once, so the app draws no SVG at runtime (ADR 0020, approach C):
//   src/renderer/src/assets/door-base.webp  wall + door body + dim carving, soft edge fade baked into the alpha
//   src/renderer/src/assets/door-lit.webp   transparent, only the glowing carving (with a soft glow baked in)
// The art is single-source: it renders DoorDefs / DoorBody from components/MoriaDoor.tsx, the same markup the LOTR scenes use.
// Run (from desktop/): node scripts/render-door.mjs      Needs electron, esbuild and sharp, all already in node_modules.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const sharp = require('sharp');
const electronPath = require('electron');
const { _electron: electron } = require('playwright-core');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src', 'renderer', 'src', 'assets');
const W = 920; // 2x of the door's max width (460 css px)
const H = 937; // keeps the door box ratio 550:560
const VIEW_BOX = '525 190 550 560'; // same as SimpleDoor
const WEBP = { quality: 82, alphaQuality: 90, effort: 6 };

// Markup of the shared door parts, rendered by React like the app does.
const bundled = await build({
  stdin: {
    contents: `import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { DoorBody, DoorDefs } from './MoriaDoor';
      export const defs = renderToStaticMarkup(createElement(DoorDefs, { glow: true }));
      export const body = renderToStaticMarkup(createElement(DoorBody));`,
    resolveDir: join(root, 'src', 'renderer', 'src', 'components'),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [join(root, 'node_modules'), join(root, '..', 'node_modules')],
  absWorkingDir: root,
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(mod, mod.exports, require);
const { defs, body } = mod.exports;

const svg = (inner, style = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${VIEW_BOX}" preserveAspectRatio="none" style="display:block;${style}"><defs>${defs}</defs>${inner}</svg>`;
const page = (s) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent;overflow:hidden">${s}</body>`;

// Base: the same stack as the old .sdoor__base, with the edge fade as a CSS mask here (baked into the alpha by the capture).
const fade =
  '-webkit-mask-image:linear-gradient(to right,transparent,#000 14%,#000 86%,transparent),linear-gradient(to bottom,transparent,#000 10%,#000 90%,transparent);-webkit-mask-composite:source-in;';
const baseHtml = page(
  svg(
    `<rect x="525" y="190" width="550" height="560" fill="url(#moria-rock)"/><rect x="525" y="190" width="550" height="560" fill="#050a16" opacity="0.35"/>${body}<use href="#moria-frame" opacity="0.16"/><use href="#moria-inner" opacity="0.16"/>`,
    fade,
  ),
);
const litHtml = page(svg('<g filter="url(#moria-glow)"><use href="#moria-frame"/><use href="#moria-inner"/></g>'));

const tmp = mkdtempSync(join(tmpdir(), 'fatup-door-'));
const mainFile = join(tmp, 'main.cjs');
writeFileSync(
  mainFile,
  `const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(() => { globalThis.render = async (html, w, h) => {
  const win = new BrowserWindow({ show: false, transparent: true, frame: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: false, sandbox: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  win.destroy();
  return img.toPNG().toString('base64');
}; });`,
);

mkdirSync(outDir, { recursive: true });
const app = await electron.launch({ executablePath: electronPath, args: [mainFile] });
try {
  await app.evaluate(async () => { while (!globalThis.render) await new Promise((r) => setTimeout(r, 50)); });
  for (const [name, html] of [['door-base', baseHtml], ['door-lit', litHtml]]) {
    const b64 = await app.evaluate((_e, a) => globalThis.render(a.html, a.w, a.h), { html, w: W, h: H });
    const file = join(outDir, `${name}.webp`);
    const info = await sharp(Buffer.from(b64, 'base64')).resize(W, H, { fit: 'fill' }).ensureAlpha().webp(WEBP).toFile(file);
    console.log(`${name}.webp  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(1)} KB`);
  }
} finally {
  await app.close();
}
