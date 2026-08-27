import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getContactBalance } from '@/lib/contact-utils';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'receipts', 'read');
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contactId');

    if (!contactId || !UUID_RE.test(contactId)) {
      return error('معرّف الطرف غير صالح');
    }

    const s = sb();

    const { data: contact, error: contactError } = await s.from('contacts')
      .select('id, type')
      .eq('id', contactId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (contactError) throw contactError;
    if (!contact) return error('الطرف غير موجود', 404);

    // الرصيد من السطور الموسومة بـ contact_id (مقيد بالشركة) — لا من account_id
    // ولا بتحميل كل قيود الشركة. سابقاً كان يعيد 0 دائماً لأن الأطراف بلا
    // account_id، وكان يجلب كل معرّفات القيود (قنبلة أداء).
    const netBalance = await getContactBalance(auth.companyId, contactId);

    if (contact.type === 'supplier' || contact.type === 'subcontractor') {
      return success({
        contact_id: contactId,
        balance: Math.abs(netBalance),
        balance_type: netBalance >= 0 ? 'debit' : 'credit',
        label: netBalance >= 0 ? 'مدين له' : 'دائن/مستحق له',
        color: netBalance >= 0 ? 'green' : 'pink',
      });
    }

    return success({
      contact_id: contactId,
      balance: Math.abs(netBalance),
      balance_type: netBalance >= 0 ? 'debit' : 'credit',
      label: netBalance >= 0 ? 'مدين' : 'دائن',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
