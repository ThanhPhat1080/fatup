/**
 * Static check of the Vault look in `desktop/src/renderer/src/styles.css` (Task 12, spec Q7-UI).
 * No browser: the stylesheet is read as text and its rules are parsed just enough to check the declarations named in the spec.
 *
 * Pinned by this file:
 * 1. `--vault` and `--vault-tint` are defined in the light root (the first top-level `:root` block, the design tokens)
 *    and again in both dark blocks the file already uses: `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`
 *    and `:root[data-theme='dark']`.
 * 2. A `.vault-mode` rule exists (the look of the app while the Vault is open).
 * 3. `.vault-trash` is a fixed panel, 70% wide above 720 px, and 100% wide inside `@media (max-width: 720px)`.
 * 4. A `.vault-trash` header rule has a red left bar: `border-left: 4px solid var(--danger)`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', 'styles.css'), 'utf8');

type Rule = {
  /** The at-rule the rule sits in, e.g. `@media (max-width: 720px)`; empty at top level. */
  media: string;
  /** The comma-separated selectors of the rule, trimmed. */
  selectors: string[];
  /** The declarations between the braces. */
  body: string;
};

/**
 * Splits a stylesheet into style rules, descending into `@media` blocks. Comments are removed first.
 * Other at-rules (`@keyframes`, `@import`) are kept as rules with an `@` selector, which the checks never match.
 */
function parseRules(source: string, context = ''): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    let prelude = text.slice(i, open);
    const semi = prelude.lastIndexOf(';');
    if (semi >= 0) prelude = prelude.slice(semi + 1);
    prelude = prelude.trim();
    if (prelude.startsWith('@media')) {
      out.push(...parseRules(body, [context, prelude].filter(Boolean).join(' and ')));
    } else {
      out.push({ media: context, selectors: prelude.split(',').map((s) => s.trim()), body });
    }
    i = j;
  }
  return out;
}

const RULES = parseRules(CSS);

const TOP = RULES.filter((r) => r.media === '');
const LIGHT_ROOT = TOP.find((r) => r.selectors.includes(':root'));
const DARK_MEDIA_ROOT = RULES.find(
  (r) => r.media === '@media (prefers-color-scheme: dark)' && r.selectors.includes(":root:not([data-theme='light'])"),
);
const DARK_ATTR_ROOT = TOP.find((r) => r.selectors.includes(":root[data-theme='dark']"));

/** A custom property declared in the body: `--name: value;`, and not a longer name that starts the same way. */
const declares = (body: string, name: string) => new RegExp(`(^|[;{\\s])${name}\\s*:`).test(body);

describe('Vault tokens in styles.css', () => {
  it('finds the light root and both dark blocks the file already uses', () => {
    expect(LIGHT_ROOT, 'top-level :root block').toBeDefined();
    expect(DARK_MEDIA_ROOT, "prefers-color-scheme: dark block for :root:not([data-theme='light'])").toBeDefined();
    expect(DARK_ATTR_ROOT, "block for :root[data-theme='dark']").toBeDefined();
  });

  it('defines --vault and --vault-tint in the light root', () => {
    expect(declares(LIGHT_ROOT!.body, '--vault')).toBe(true);
    expect(declares(LIGHT_ROOT!.body, '--vault-tint')).toBe(true);
  });

  it('defines --vault and --vault-tint again in the dark mode the OS picks', () => {
    expect(declares(DARK_MEDIA_ROOT!.body, '--vault')).toBe(true);
    expect(declares(DARK_MEDIA_ROOT!.body, '--vault-tint')).toBe(true);
  });

  it('defines --vault and --vault-tint again in the dark mode the user picks', () => {
    expect(declares(DARK_ATTR_ROOT!.body, '--vault')).toBe(true);
    expect(declares(DARK_ATTR_ROOT!.body, '--vault-tint')).toBe(true);
  });
});

describe('Vault mode and Vault trash rules', () => {
  it('has a .vault-mode rule', () => {
    expect(RULES.some((r) => r.selectors.some((s) => /(^|[\s,>+~:])\.vault-mode(?![\w-])/.test(s)))).toBe(true);
  });

  it('makes .vault-trash a fixed panel 70% wide above 720 px', () => {
    const panel = TOP.find((r) => r.selectors.includes('.vault-trash'));
    expect(panel, 'top-level .vault-trash rule').toBeDefined();
    expect(panel!.body).toMatch(/position:\s*fixed/);
    expect(panel!.body).toMatch(/width:\s*70%/);
  });

  it('makes .vault-trash full width inside @media (max-width: 720px)', () => {
    const narrow = RULES.find(
      (r) => r.media.includes('(max-width: 720px)') && r.selectors.includes('.vault-trash'),
    );
    expect(narrow, '.vault-trash rule inside @media (max-width: 720px)').toBeDefined();
    expect(narrow!.body).toMatch(/width:\s*100%/);
  });

  it('draws the Vault trash header with a red left bar in var(--danger)', () => {
    const header = RULES.find(
      (r) => r.selectors.some((s) => s.includes('.vault-trash')) && /border-left:\s*4px solid var\(--danger\)/.test(r.body),
    );
    expect(header, 'a .vault-trash rule with border-left: 4px solid var(--danger)').toBeDefined();
  });
});
