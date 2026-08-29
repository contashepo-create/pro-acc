/**
 * Renders the equipment-costs dashboard page against realistic API payloads.
 * Guards against the production "نعتذر عن هذا الخطأ" client crash.
 */
import { render, screen, waitFor } from '@testing-library/react';
import EquipmentCostsPage from '@/app/(dashboard)/equipment/page';

const responses: Record<string, unknown> = {};

function jsonResponse(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body), ok: true, status: 200 });
}

global.fetch = (jest.fn((url: unknown) => {
  if (String(url).includes('/api/equipment-costs')) return jsonResponse(responses['costs']);
  if (String(url).includes('/api/projects')) return jsonResponse(responses['projects']);
  if (String(url).includes('/api/fixed-assets')) return jsonResponse(responses['assets']);
  return jsonResponse({ success: false, message: 'unexpected ' + String(url) });
}) as unknown as typeof fetch);

describe('equipment costs page renders', () => {
  beforeEach(() => {
    responses['costs'] = {
      success: true,
      data: {
        rows: [
          {
            id: 'c1', date: '2026-01-10', cost_type: 'fuel', usage_hours: 4,
            amount: 250.5, notes: null,
            fixed_assets: { name: 'حفارة' }, projects: { name: 'مشروع برج' },
          },
          {
            id: 'c2', date: '2026-01-11', cost_type: 'other', usage_hours: null,
            amount: 100, notes: 'تنظيف', fixed_assets: null, projects: null,
          },
        ],
        total: 2, page: 1, pageSize: 25,
      },
    };
    responses['projects'] = {
      success: true,
      data: { rows: [{ id: 'p1', name: 'مشروع برج' }], total: 1 },
    };
    // REAL shape: /api/fixed-assets returns { assets: [...] } — NOT rows.
    // The earlier mock used data.rows, which masked the production crash
    // ("نعتذر عن هذا الخطأ" — assets.map is not a function). See
    // scripts/equipment-live-repro.ts + equipment-live-replay.test.tsx.
    responses['assets'] = {
      success: true,
      data: { assets: [{ id: 'a1', name: 'حفارة' }], total: 1 },
    };
  });

  test('renders table rows without crashing', async () => {
    render(<EquipmentCostsPage />);
    await waitFor(() => {
      expect(screen.getByText('حفارة')).toBeInTheDocument();
    });
    expect(screen.getByText('مشروع برج')).toBeInTheDocument();
  });

  test('survives empty lists, error payloads, and missing data objects', async () => {
    responses['costs'] = { success: true, data: { rows: [], total: 0 } };
    responses['projects'] = { success: false, message: 'لا شيء' };
    responses['assets'] = { success: false, message: 'لا شيء' };
    const view = render(<EquipmentCostsPage />);
    await waitFor(() => {
      expect(view.getByText('لا توجد بيانات')).toBeInTheDocument();
    });

    // data object entirely absent must not throw either
    responses['costs'] = { success: true };
    responses['projects'] = { success: true };
    responses['assets'] = { success: true };
    view.unmount();
    const second = render(<EquipmentCostsPage />);
    await waitFor(() => {
      expect(second.getByText('لا توجد بيانات')).toBeInTheDocument();
    });
  });
});
