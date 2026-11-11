import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const stylesheetUrl = new URL('../../src/app/globals.css', import.meta.url);
const stylesheet = readFileSync(stylesheetUrl, 'utf8');
const css = [...stylesheet.matchAll(/@import ['"]([^'"]+\.css)['"]/g)]
  .map((match) => readFileSync(new URL(match[1], stylesheetUrl), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].split(',').map((selector) => selector.trim()),
  declarations: match[2].split(';').flatMap((declaration) => {
    const colon = declaration.indexOf(':');
    return colon < 0
      ? []
      : [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]];
  }),
}));

// Read the shipped declarations, not copies of the colors under test.
// Candidates are explicitly listed in cascade priority order (base before components).
// Browser closure tests separately verify the full rendered cascade.
function declarationsFor(...selectors: string[]) {
  const declarations = new Map<string, string>();
  for (const selector of selectors) {
    for (const rule of rules) {
      if (!rule.selectors.includes(selector)) continue;
      for (const [property, value] of rule.declarations) declarations.set(property, value);
    }
  }
  return declarations;
}

function luminance(hex: string) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected an opaque RGB color, got ${hex}`);
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function expectVisibleFocus(declarations: Map<string, string>, surfaces: string[]) {
  const outline = declarations.get('outline') ?? '';
  const parts = outline.match(/^(\d+(?:\.\d+)?)px\s+solid\s+(#[\da-f]{6})$/i);
  expect(parts, `Visible solid focus outline, got ${outline}`).not.toBeNull();
  if (!parts) return;
  expect(Number(parts[1])).toBeGreaterThanOrEqual(2);
  for (const surface of surfaces) {
    expect(contrast(parts[2], surface), `${parts[2]} focus on ${surface}`).toBeGreaterThanOrEqual(
      3,
    );
  }
}

describe('WCAG contrast of the shipped stylesheet', () => {
  it('uses the WCAG sRGB calculation against independently known reference ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBe(21);
    expect(contrast('#ff0000', '#ffffff')).toBeCloseTo(3.99847677, 7);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.47808945, 7);
  });

  it('keeps hero select keyboard focus at least 2px and 3:1 on light surfaces', () => {
    expectVisibleFocus(
      declarationsFor(
        'select:focus-visible',
        '.hero-search select',
        '.hero-search select:focus-visible',
      ),
      ['#ffffff', declarationsFor('.public-shell').get('background') ?? ''],
    );
  });

  it('keeps assistant launcher keyboard focus at least 2px and 3:1 on light surfaces', () => {
    expectVisibleFocus(
      declarationsFor(
        'button:focus-visible',
        '.agent-fab:focus-visible',
        '.public-shell .agent-fab:focus-visible',
      ),
      [
        '#ffffff',
        declarationsFor('.public-shell').get('background') ?? '',
        declarationsFor(':root').get('--background') ?? '',
      ],
    );
  });

  it('keeps every small status badge at or above 4.5:1 against its own background', () => {
    const failures = [
      'unknown',
      'confirmed',
      'approved',
      'active',
      'paid_cash',
      'checked_in',
      'pending',
      'trialing',
      'completed',
      'cancelled',
      'rejected',
      'no_show',
    ].flatMap((status) => {
      const badge = declarationsFor('.badge', `.badge-${status}`);
      const foreground = badge.get('color') ?? '';
      const background = badge.get('background') ?? '';
      const ratio = contrast(foreground, background);
      return ratio < 4.5 ? [{ status, foreground, background, ratio }] : [];
    });
    expect(failures).toEqual([]);
  });
});
