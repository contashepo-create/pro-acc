/**
 * LIVE replay of the equipment-costs page against REAL recorded API payloads.
 *
 * The payloads come from scripts/equipment-live-repro.ts, which runs the
 * genuine route handlers (/api/equipment-costs, /api/projects,
 * /api/fixed-assets) against a genuine Postgres (PGlite + full migration
 * schema). If this render throws, the production error boundary
 * ("نعتذر عن هذا الخطأ") is explained by data, not by theory.
 *
 * Regenerate fixtures: npx tsx scripts/equipment-live-repro.ts [scenario]
 */
import { render, screen, waitFor } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import EquipmentCostsPage from '@/app/(dashboard)/equipment/page';

const fixturesFile = path.join(__dirname, '../../scripts/equipment-live-fixtures.json');

function loadFixtures(): Record<string, any> {
  if (!fs.existsSync(fixturesFile)) {
    throw new Error(
      'fixtures missing — run: npx tsx scripts/equipment-live-repro.ts basic');
  }
  return JSON.parse(fs.readFileSync(fixturesFile, 'utf8'));
}

let fixtures: Record<string, any>;

beforeAll(() => {
  fixtures = loadFixtures();
  (global as any).fetch = (url: string) => {
    const clean = String(url).split('?')[0];
    const hit = fixtures[clean];
    if (!hit) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: false, message: 'no fixture for ' + clean }) });
    return Promise.resolve({ ok: true, status: hit.status, json: () => Promise.resolve(hit.body) });
  };
});

describe('equipment costs page — live payload replay', () => {
  test('renders the real /api/equipment-costs payload without crashing', async () => {
    const view = render(<EquipmentCostsPage />);
    // Wait past the loading skeleton until real data (or the empty state /
    // error banner) settles. A throw here reproduces the dashboard boundary.
    await waitFor(() => {
      const costs = fixtures['/api/equipment-costs'];
      const rows = costs?.body?.data?.rows ?? [];
      if (rows.length) {
        const assetName = rows.find((r: any) => r.fixed_assets?.name)?.fixed_assets?.name;
        expect(assetName && screen.getAllByText(assetName).length).toBeGreaterThan(0);
      } else {
        expect(view.getByText('لا توجد بيانات')).toBeInTheDocument();
      }
    }, { timeout: 4000 });
  });
});
