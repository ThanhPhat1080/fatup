import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SimpleDoor } from '../src/renderer/src/components/SimpleDoor';
import { DoorDefs } from '../src/renderer/src/components/MoriaDoor';

const CSS = readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Top-level-ish rules (flat parse, at-rule wrappers ignored): [selector list, body]. */
function rules(css: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}
const sdoor = rules(CSS).filter((r) => r.sel.split(',').some((s) => s.trim().startsWith('.sdoor')));

const ASSETS = join(__dirname, '..', 'src', 'renderer', 'src', 'assets');
const MAX_ASSET_BYTES = 160 * 1024;

describe('SimpleDoor markup', () => {
  const html = renderToStaticMarkup(createElement(SimpleDoor, { open: false, label: 'VAULT', children: 'x' }));

  it('is two plain images plus the label: no SVG art, filter, mask, gradient or <use>', () => {
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('sdoor__base');
    expect(html).toContain('sdoor__lit');
    for (const bad of ['<use', '<filter', '<mask', 'Gradient', 'feGaussianBlur', 'moria-', 'gate__halo', 'gate__stones']) expect(html).not.toContain(bad);
    expect(html.match(/<svg /g)).toHaveLength(1); // only the label
  });

  it('keeps the VAULT label as static text on the arch', () => {
    expect(html).toContain('VAULT');
    expect(html).toContain('textPath');
    expect(renderToStaticMarkup(createElement(SimpleDoor, { open: false, children: 'x' }))).not.toContain('<svg');
  });

  it('adds sdoor--open when open, sdoor--6 for six cells', () => {
    expect(html).not.toContain('sdoor--open');
    expect(renderToStaticMarkup(createElement(SimpleDoor, { open: true, children: 'x' }))).toContain('sdoor--open');
    expect(renderToStaticMarkup(createElement(SimpleDoor, { open: false, cells: 6, children: 'x' }))).toContain('sdoor--6');
  });
});

describe('pre-rendered door assets', () => {
  for (const name of ['door-base.webp', 'door-lit.webp']) {
    it(`${name} exists and stays small`, () => {
      const size = statSync(join(ASSETS, name)).size;
      expect(size).toBeGreaterThan(1000);
      expect(size).toBeLessThan(MAX_ASSET_BYTES);
    });
  }
});

describe('DoorDefs glow flag', () => {
  it('keeps the glow filter by default and drops it with glow={false}', () => {
    expect(renderToStaticMarkup(createElement(DoorDefs))).toContain('moria-glow');
    expect(renderToStaticMarkup(createElement(DoorDefs, { glow: false }))).not.toContain('moria-glow');
  });
});

describe('.sdoor styles', () => {
  it('exist and use no filter, blur, mask or door leaves', () => {
    expect(sdoor.length).toBeGreaterThan(0);
    for (const r of sdoor) {
      expect(r.body).not.toContain('filter:');
      expect(r.body).not.toContain('blur(');
      expect(r.body).not.toContain('mask');
      expect(r.body).not.toContain('gradient');
      expect(r.body).not.toContain('moria-leaf');
    }
  });

  it('has exactly one animated layer: the lit image, a slow opacity breathe of at least 3 s', () => {
    const animated = sdoor.filter((r) => /(^|[\s;])animation:/.test(r.body) && !/animation:\s*none/.test(r.body));
    expect(animated.map((r) => r.sel)).toEqual(['.sdoor__lit']);
    expect(animated[0].body).toContain('will-change: opacity');
    const secs = /animation:[^;]*?(\d+(?:\.\d+)?)s/.exec(animated[0].body);
    expect(Number(secs?.[1])).toBeGreaterThanOrEqual(3);
    const kf = /@keyframes sdoor-breathe\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(kf).toContain('opacity');
    expect(kf.replace(/opacity:\s*[\d.]+;/g, '').replace(/[\d%,\s{}]/g, '')).toBe('');
  });

  it('stops the animation for reduced motion', () => {
    const idx = CSS.indexOf('@media (prefers-reduced-motion: reduce)', CSS.indexOf('.sdoor__lit'));
    expect(idx).toBeGreaterThan(-1);
    const block = CSS.slice(idx, CSS.indexOf('}\n}', idx) + 3);
    expect(block).toContain('.sdoor__lit');
    expect(block).toContain('animation: none');
  });
});
