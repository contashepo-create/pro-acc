import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { generateId } from '@/lib/utils';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: projectRes, error: pErr } = await s.from('projects')
      .select('*, contacts(name)').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (pErr || !projectRes) return notFound();
    const project: any = projectRes;

    // Get journal entries for this project
    const { data: jes } = await s.from('journal_entries')
      .select('id').eq('project_id', id).eq('company_id', auth.companyId);
    const jeIds = (jes || []).map((je: any) => je.id);

    let totalCost = 0;
    let totalRevenue = 0;

    if (jeIds.length > 0) {
      const { data: lines } = await s.from('journal_lines')
        .select('debit, credit, accounts(type)')
        .in('journal_entry_id', jeIds);
      for (const l of (lines || [])) {
        const accType = (l.accounts as any)?.type;
        const debit = parseFloat(l.debit) || 0;
        const credit = parseFloat(l.credit) || 0;
        if (accType === 'expense') totalCost += debit - credit;
        if (accType === 'revenue') totalRevenue += credit - debit;
      }
    }

    // Also check journal_lines with project_id directly
    const { data: directLines } = await s.from('journal_lines')
      .select('debit, credit, accounts(type)')
      .eq('project_id', id);
    for (const l of (directLines || [])) {
      const accType = (l.accounts as any)?.type;
      const debit = parseFloat(l.debit) || 0;
      const credit = parseFloat(l.credit) || 0;
      if (accType === 'expense') totalCost += debit - credit;
      if (accType === 'revenue') totalRevenue += credit - debit;
    }

    const { data: invRes } = await s.from('invoices')
      .select('id, number, total, paid_amount, status')
      .eq('project_id', id).eq('company_id', auth.companyId).order('created_at', { ascending: false });

    return success({
      ...project,
      client_name: project.contacts?.name || null,
      cost_summary: {
        total_cost: totalCost,
        total_revenue: totalRevenue,
        net_profit: parseFloat(project.contract_value) - totalCost,
      },
      invoices: (invRes || []).map((inv: any) => ({
        ...inv,
        total: parseFloat(inv.total),
        paid_amount: parseFloat(inv.paid_amount || '0'),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: projectRes } = await s.from('projects')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!projectRes) return notFound();
    const existing: any = projectRes;

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.client_id !== undefined) updateData.client_id = body.client_id;
    if (body.contract_value !== undefined) updateData.contract_value = body.contract_value;
    if (body.start_date !== undefined) updateData.start_date = body.start_date;
    if (body.end_date !== undefined) updateData.end_date = body.end_date;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.location !== undefined) updateData.location = body.location;

    if (Object.keys(updateData).length > 0) {
      const { error: updErr } = await s.from('projects').update(updateData).eq('id', id);
      if (updErr) throw updErr;
    }

    // Contract value adjustment with journal entry
    if (body.contract_value !== undefined && parseFloat(body.contract_value) !== parseFloat(existing.contract_value)) {
      const { data: invRes } = await s.from('invoices')
        .select('id, status, journal_entry_id')
        .eq('project_id', id).eq('company_id', auth.companyId)
        .not('status', 'in', '("paid","cancelled")').limit(1).maybeSingle();

      if (invRes) {
        const inv: any = invRes;
        const oldValue = parseFloat(existing.contract_value);
        const newValue = parseFloat(body.contract_value);
        const diff = newValue - oldValue;

        await s.from('invoices').update({ total: newValue, subtotal: newValue }).eq('id', inv.id);

        if (inv.journal_entry_id) {
          const { data: arContact } = await s.from('contacts').select('account_id').eq('id', existing.client_id).maybeSingle();
          const { data: revAcc } = await s.from('accounts').select('id').eq('code', '4100').eq('company_id', auth.companyId).maybeSingle();

          if (arContact?.account_id && revAcc) {
            const adjJeId = generateId();
            const { data: maxJe } = await s.from('journal_entries')
              .select('number').eq('company_id', auth.companyId).order('number', { ascending: false }).limit(1).maybeSingle();
            const adjSeq = ((maxJe as any)?.number || 0) + 1;

            await s.from('journal_entries').insert({
              id: adjJeId, company_id: auth.companyId, number: adjSeq,
              date: body.start_date || existing.start_date, type: 'adjustment',
              description: `تعديل قيمة العقد للمشروع: ${existing.name}`, project_id: id, created_by: auth.userId,
            });

            if (diff > 0) {
              await s.from('journal_lines').insert([
                { id: generateId(), journal_entry_id: adjJeId, account_id: arContact.account_id, debit: diff, credit: 0, description: `تعديل قيمة العقد (+${diff})`, project_id: id },
                { id: generateId(), journal_entry_id: adjJeId, account_id: revAcc.id, debit: 0, credit: diff, description: `تعديل قيمة العقد (+${diff})`, project_id: id },
              ]);
            } else {
              const absDiff = Math.abs(diff);
              await s.from('journal_lines').insert([
                { id: generateId(), journal_entry_id: adjJeId, account_id: arContact.account_id, debit: 0, credit: absDiff, description: `تعديل قيمة العقد (${diff})`, project_id: id },
                { id: generateId(), journal_entry_id: adjJeId, account_id: revAcc.id, debit: absDiff, credit: 0, description: `تعديل قيمة العقد (${diff})`, project_id: id },
              ]);
            }
          }
        }
      }
    }

    const { data: updated, error: fetchErr } = await s.from('projects')
      .select('*, contacts(name)').eq('id', id).single();
    if (fetchErr) throw fetchErr;

    const result: any = updated;
    return success({ ...result, client_name: result.contacts?.name || null });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: projectRes } = await s.from('projects')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!projectRes) return notFound();

    const { data: depRes } = await s.from('invoices')
      .select('id').eq('project_id', id).neq('status', 'cancelled').limit(1);
    if (depRes && depRes.length > 0) {
      return error('لا يمكن حذف المشروع لأنه مرتبط بفواتير غير ملغاة');
    }

    const { data: jeDeps } = await s.from('journal_entries').select('id').eq('project_id', id);
    for (const je of (jeDeps || [])) {
      await s.from('journal_lines').delete().eq('journal_entry_id', je.id);
      await s.from('journal_entries').delete().eq('id', je.id);
    }

    const { error: updErr } = await s.from('projects').update({ status: 'cancelled' }).eq('id', id);
    if (updErr) throw updErr;

    return success({ message: 'تم إلغاء المشروع بنجاح' });
  } catch (err) {
    return handleApiError(err);
  }
}
