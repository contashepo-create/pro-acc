/**
 * دالة مساعدة لإنشاء حساب محاسبي تلقائياً
 * تُستخدم عند إنشاء كيانات تحتاج حسابات (بنوك، أصول، مخزون، إلخ)
 */

import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

interface CreateAccountParams {
  companyId: string;
  code: string;
  name: string;
  nameEn?: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode: string; // رمز الحساب الأب (مثال: '1120')
  openingBalance?: number;
}

export async function createAutoAccount(params: CreateAccountParams): Promise<{ id: string; code: string; name: string } | null> {
  const s = sb();

  try {
    // 1. البحث عن الحساب الأب
    const { data: parentAccount } = await s.from('accounts')
      .select('id')
      .eq('company_id', params.companyId)
      .eq('code', params.parentCode)
      .maybeSingle();

    if (!parentAccount) {
      console.warn(`Parent account ${params.parentCode} not found`);
      return null;
    }

    // 2. التحقق من أن الحساب غير موجود مسبقاً
    const { data: existing } = await s.from('accounts')
      .select('id')
      .eq('company_id', params.companyId)
      .eq('code', params.code)
      .maybeSingle();

    if (existing) {
      return { id: existing.id, code: params.code, name: params.name };
    }

    // 3. إنشاء الحساب الجديد
    const { data: newAccount, error } = await s.from('accounts')
      .insert({
        company_id: params.companyId,
        code: params.code,
        name: params.name,
        name_en: params.nameEn || null,
        type: params.type,
        parent_id: parentAccount.id,
        is_active: true,
      })
      .select('id, code, name')
      .single();

    if (error) {
      console.error('Failed to create auto account:', error);
      return null;
    }

    // 4. إذا كان رصيد افتتاحي، إنشاء قيد افتتاحي
    if (params.openingBalance && params.openingBalance !== 0) {
      const { data: jeNum } = await s.rpc('next_journal_number', {
        p_company_id: params.companyId,
        p_year: new Date().getFullYear(),
      });

      if (jeNum) {
        const { data: je } = await s.from('journal_entries')
          .insert({
            company_id: params.companyId,
            number: jeNum,
            date: new Date().toISOString().split('T')[0],
            type: 'opening_balance',
            description: `رصيد افتتاحي - ${params.name}`,
          })
          .select('id')
          .single();

        if (je) {
          if (params.openingBalance > 0) {
            // مدين
            await s.from('journal_lines').insert({
              journal_entry_id: je.id,
              account_id: newAccount.id,
              account_code: params.code,
              debit: params.openingBalance,
              credit: 0,
              description: 'رصيد افتتاحي',
            });
          } else {
            // دائن
            await s.from('journal_lines').insert({
              journal_entry_id: je.id,
              account_id: newAccount.id,
              account_code: params.code,
              debit: 0,
              credit: Math.abs(params.openingBalance),
              description: 'رصيد افتتاحي',
            });
          }
        }
      }
    }

    return { id: newAccount.id, code: newAccount.code, name: newAccount.name };
  } catch (err) {
    console.error('Error in createAutoAccount:', err);
    return null;
  }
}
