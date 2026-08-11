import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { contactUpdateSchema } from '@/lib/validation';
import { getContactBalance } from '@/lib/contact-utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'contacts', 'read');
    const { id } = await params;
    const s = sb();

    const { data: contact, error: queryError } = await s.from('contacts')
      .select('*, accounts(code, name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryError || !contact) {
      return notFound();
    }

    const c = contact as Record<string, any>;

    // الرصيد من سطور القيد الموسومة بـ contact_id (حسابات تحكم + وسم)،
    // مقيد بالشركة — لا من account_id (الذي يبقى null في هذا النموذج) ولا
    // بتحميل كل قيود الشركة (قنبلة أداء سابقة).
    const balance = await getContactBalance(auth.companyId, id);

    return success({
      ...c,
      account_code: c.accounts?.code || null,
      account_name: c.accounts?.name || null,
      balance,
      balance_type: balance >= 0 ? 'debit' : 'credit',
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
    const auth = await requireModulePermission(request, 'contacts', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const parsed = contactUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { data: contactRes } = await s.from('contacts')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!contactRes) {
      return notFound();
    }

    const contact = contactRes as Record<string, any>;

    const updateData: Record<string, any> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
    if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
    if (parsed.data.email !== undefined) updateData.email = parsed.data.email;
    if (parsed.data.tax_number !== undefined) updateData.tax_number = parsed.data.tax_number;
    if (parsed.data.address !== undefined) updateData.address = parsed.data.address;
    if (parsed.data.commercial_registration !== undefined) updateData.commercial_registration = parsed.data.commercial_registration;
    if (parsed.data.credit_limit !== undefined) updateData.credit_limit = parsed.data.credit_limit;

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await s.from('contacts')
        .update(updateData)
        .eq('id', id)
        .eq('company_id', auth.companyId);
      if (updateError) throw updateError;
    }

    // NOTE: لا نُنشئ حساباً فرعياً بكلون مكرر (1130/2110). النموذج يعتمد حسابات
    // التحكم + وسم contact_id على السطور؛ إنشاء حسابات مكررة بالكود نفسه كان
    // يكسر resolveAccountId ويُفسد الدليل المحاسبي. account_id يبقى كما هو.

    const { data: updated, error: fetchError } = await s.from('contacts')
      .select('*, accounts(code, name)')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const u = updated as Record<string, any>;
    return success({
      ...u,
      account_code: u.accounts?.code || null,
      account_name: u.accounts?.name || null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: contactRes } = await s.from('contacts')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!contactRes) {
      return notFound();
    }

    const contact = contactRes as Record<string, any>;

    // حواجز التبعيات — كلها مقيدة بالشركة لمنع المراجع اليتيمة
    const { data: invDep } = await s.from('invoices')
      .select('id').eq('contact_id', id).eq('company_id', auth.companyId).limit(1);
    if (invDep && invDep.length > 0) {
      return error('لا يمكن حذف الطرف لأنه مرتبط بفواتير');
    }

    const { data: projDep } = await s.from('projects')
      .select('id').eq('client_id', id).eq('company_id', auth.companyId).limit(1);
    if (projDep && projDep.length > 0) {
      return error('لا يمكن حذف الطرف لأنه مرتبط بمشاريع');
    }

    const { data: piDep } = await s.from('purchase_invoices')
      .select('id').eq('supplier_id', id).eq('company_id', auth.companyId).limit(1);
    if (piDep && piDep.length > 0) {
      return error('لا يمكن حذف الطرف لأنه مرتبط بفواتير مشتريات');
    }

    const { data: rcptDep } = await s.from('voucher_receipts')
      .select('id').eq('contact_id', id).eq('company_id', auth.companyId).limit(1);
    if (rcptDep && rcptDep.length > 0) {
      return error('لا يمكن حذف الطرف لأنه مرتبط بسندات قبض');
    }

    const { data: disbDep } = await s.from('voucher_disbursements')
      .select('id').eq('contact_id', id).eq('company_id', auth.companyId).limit(1);
    if (disbDep && disbDep.length > 0) {
      return error('لا يمكن حذف الطرف لأنه مرتبط بسندات صرف');
    }

    // رصيد غير صفري = حركات مالية مرتبطة — لا حذف حتى لا تنفصل الدفاتر
    const balance = await getContactBalance(auth.companyId, id);
    if (Math.abs(balance) > 0.01) {
      return error('لا يمكن حذف طرف له رصيد — صفِّ الحساب أولاً');
    }

    // إن وُجد حساب قديم مرتبط (حالات نادرة)، عطّله دون حذف (يحفظ أثر الدفاتر)
    if (contact.account_id) {
      await s.from('accounts')
        .update({ is_active: false })
        .eq('id', contact.account_id)
        .eq('company_id', auth.companyId);
    }

    const { error: deleteError } = await s.from('contacts')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId);
    if (deleteError) throw deleteError;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
