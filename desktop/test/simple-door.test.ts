import { readFileSync } from 'node:fs';
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

describe('SimpleDoor markup', () => {
  const html = renderToStaticMarkup(createElement(SimpleDoor, { open: false, label: 'VAULT', children: 'x' }));

  it('has the label and the lit layer, none of the heavy parts', () => {
    expect(html).toContain('VAULT');
    expect(html).toContain('sdoor__lit');
    for (const bad of ['feGaussianBlur', 'moria-glow', 'gate__halo', 'gate__stones']) expect(html).not.toContain(bad);
  });

  it('adds sdoor--open when open, sdoor--6 for six cells', () => {
    expect(html).not.toContain('sdoor--open');
    expect(renderToStaticMarkup(createElement(SimpleDoor, { open: true, children: 'x' }))).toContain('sdoor--open');
    expect(renderToStaticMarkup(createElement(SimpleDoor, { open: false, cells: 6, children: 'x' }))).toContain('sdoor--6');
  });
});

describe('DoorDefs glow flag', () => {
  it('keeps the glow filter by default and drops it with glow={false}', () => {
    expect(renderToStaticMarkup(createElement(DoorDefs))).toContain('moria-glow');
    expect(renderToStaticMarkup(createElement(DoorDefs, { glow: false }))).not.toContain('moria-glow');
  });
});

describe('.sdoor styles', () => {
  it('exist and use no filter, blur or door leaves', () => {
    expect(sdoor.length).toBeGreaterThan(0);
    for (const r of sdoor) {
      expect(r.body).not.toContain('filter:');
      expect(r.body).not.toContain('blur(');
      expect(r.body).not.toContain('moria-leaf');
    }
  });

  it('breathes the lit layer slowly with opacity only', () => {
    const lit = sdoor.find((r) => r.sel === '.sdoor__lit');
    expect(lit?.body).toContain('will-change: opacity');
    const secs = /animation:[^;]*?(\d+(?:\.\d+)?)s/.exec(lit?.body ?? '');
    expect(Number(secs?.[1])).toBeGreaterThanOrEqual(3);
  });

  it('stops the animation for reduced motion', () => {
    const idx = CSS.indexOf('@media (prefers-reduced-motion: reduce)', CSS.indexOf('.sdoor__lit'));
    expect(idx).toBeGreaterThan(-1);
    const block = CSS.slice(idx, CSS.indexOf('}\n}', idx) + 3);
    expect(block).toContain('.sdoor__lit');
    expect(block).toContain('animation: none');
  });
});
