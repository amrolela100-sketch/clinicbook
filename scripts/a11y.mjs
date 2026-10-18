import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const output = [];
for (const route of ['/', '/workspace/dashboard']) {
  if (route.includes('workspace'))
    await p.request.post('http://localhost:3000/api/session', { data: { role: 'clinic_owner' } });
  await p.goto('http://localhost:3000' + route);
  await p
    .locator(route === '/' ? '.hero' : '.stat-card')
    .first()
    .waitFor();
  await p.waitForTimeout(800);
  const results = await new AxeBuilder({ page: p })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  output.push({
    route,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  });
}
fs.writeFileSync('docs/a11y.json', JSON.stringify(output, null, 2));
for (const o of output)
  console.log(
    o.route,
    o.violations.map((v) => ({ id: v.id, n: v.nodes.length, samples: v.nodes.slice(0, 3) })),
  );
await b.close();
