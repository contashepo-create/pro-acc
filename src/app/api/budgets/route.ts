import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, notFound, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const uuidSchema = z.string().uuid();
const createSchema = z.object({
  project_id: uuidSchema,
  category: z.enum(['materials', 'labor', 'equipment', 'subcontractor', 'overhead', 'other']),
  subcategory: z.string().trim().max(100).optional().nullable(),
  amount: z.number().finite().positive().max(9999999999999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8),
  period: z.enum(['total', 'monthly', 'quarterly', 'phase']).default('total'),
  notes: z.string().trim().max(1000).optional().nullable(),
}).strict();
const amount = (value: unknown) => Number(value) || 0;

/** List atomic project budgets with posted-ledger net actuals. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'budgets', 'read');
    const projectId = new URL(request.url).searchParams.get('project_id');
    if (projectId && !uuidSchema.safeParse(projectId).success) return error('معرّف المشروع غير صالح');
    const s = getSupabase();
    if (projectId) {
      const { data: project, error: projectError } = await s.from('projects').select('id')
        .eq('id', projectId).eq('company_id', auth.companyId).maybeSingle();
      if (projectError) throw projectError;
      if (!project) return notFound();
    }

    const { data, error: queryError } = await s.rpc('get_project_budget_rows', {
      p_company_id: auth.companyId,
      p_project_id: projectId || null,
    });
    if (queryError) throw queryError;
    const actualByScope = new Map<string, number>();
    const budgets = (data || []).map((row: any) => {
      const budgetAmount = amount(row.amount);
      const actual = amount(row.actual_spent);
      actualByScope.set(`${row.project_id}:${row.category}`, actual);
      const variance = budgetAmount - actual;
      return {
        ...row,
        projects: undefined,
        actual_spent: actual,
        variance,
        variance_percent: budgetAmount > 0 ? (variance / budgetAmount) * 100 : 0,
        is_over_budget: variance < 0,
      };
    });
    const totalBudget = budgets.reduce((sum: number, row: any) => sum + amount(row.amount), 0);
    const totalActual = [...actualByScope.values()].reduce((sum, value) => sum + value, 0);
    return success({
      budgets,
      summary: {
        totalBudget,
        totalActual,
        totalVariance: totalBudget - totalActual,
        utilizationPercent: totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Create exactly one audited budget per project/category. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'budgets', 'create');
    const parsed = createSchema.safeParse(await parseBody<unknown>(request));
    if (!parsed.success) return error('بيانات الميزانية غير صالحة');
    const input = parsed.data;
    const { data, error: createError } = await getSupabase().rpc('create_project_budget_atomic', {
      p_company_id: auth.companyId,
      p_project_id: input.project_id,
      p_category: input.category,
      p_subcategory: input.subcategory || '',
      p_amount: input.amount,
      p_period: input.period,
      p_notes: input.notes || '',
      p_user_id: auth.userId,
    });
    if (createError) {
      const message = String(createError.message || '');
      if (message.includes('المشروع غير موجود')) return notFound();
      if (message.includes('توجد ميزانية')) return error(message, 409);
      if (message.includes('غير صالحة')) return error(message);
      throw createError;
    }
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
