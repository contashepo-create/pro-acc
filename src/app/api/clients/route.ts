import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireApiAuth, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'clients', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const contactId = url.searchParams.get('contactId');

    let query = s.from('contacts')
      .select('*, accounts(code, name)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .in('type', ['client', 'both']);

    if (contactId) {
      query = query.eq('id', contactId);
    }

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('name')
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const clients = (data || []).map((c: any) => ({
      ...c,
      account_code: c.accounts?.code || null,
      account_name: c.accounts?.name || null,
      balance: 0,
    }));

    // Calculate real balances from journal_lines
    const accountIds = clients.filter((c: any) => c.account_id).map((c: any) => c.account_id);
    if (accountIds.length > 0) {
      const { data: lines } = await s.from('journal_lines')
        .select('account_id, debit, credit')
        .in('account_id', accountIds);
      const balanceMap: Record<string, number> = {};
      (lines || []).forEach((l: any) => {
        const accId = l.account_id;
        if (!balanceMap[accId]) balanceMap[accId] = 0;
        balanceMap[accId] += (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0);
      });
      clients.forEach((c: any) => {
        if (c.account_id && balanceMap[c.account_id] !== undefined) {
          c.balance = balanceMap[c.account_id];
        }
      });
    }

    return success({ clients, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'clients', 'create');
    const s = sb();
    const data = await parseBody(req);

    if (!data.name) return error('اسم العميل مطلوب');

    const insertData: any = {
      company_id: auth.companyId,
      name: data.name,
      type: data.type || 'client',
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      tax_number: data.tax_number || null,
      commercial_registration: data.commercial_registration || null,
      credit_limit: data.credit_limit || 0,
      is_active: true,
      created_by: auth.userId,
    };

    // Extended fields (safe — will be ignored if columns don't exist yet)
    const extendedFields = [
      'contact_person', 'contact_person_phone', 'contact_person_email',
      'city', 'region', 'country', 'postal_code', 'website',
      'iban', 'bank_name', 'swift_code',
      'opening_balance', 'opening_balance_type', 'payment_terms',
      'notes', 'date_of_birth', 'gender', 'national_id', 'category',
    ];

    extendedFields.forEach(field => {
      if (data[field] !== undefined) {
        insertData[field] = data[field];
      }
    });

    const { data: result, error: insertError } = await s.from('contacts')
      .insert(insertData)
      .select('*')
      .single();

    if (insertError) throw insertError;

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
