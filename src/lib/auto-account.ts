/**
 * دالة مساعدة لإنشاء حساب محاسبي تلقائياً
 * تُستخدم عند إنشاء كيانات تحتاج حسابات (بنوك، أصول، مخزون، إلخ)
 */

import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';

const sb = () => getSupabase();

interface CreateAccountParams {
  companyId: string;
  code: string;
  name: string;
  nameEn?: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode: string;
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
      const jeNum = await getNextJournalNumber(params.companyId, new Date().toISOString());

      // الحصول على حساب رأس المال أو الحساب المقابل
      const { data: capitalAcc } = await s.from('accounts')
        .select('id, code, name')
        .eq('company_id', params.companyId)
        .eq('code', '3100') // رأس المال
        .maybeSingle();

      const { data: je, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: params.companyId,
          number: jeNum,
          date: new Date().toISOString().split('T')[0],
          type: 'opening_balance',
          description: `رصيد افتتاحي - ${params.name}`,
          created_by: (await s.from('users').select('id').eq('company_id', params.companyId).limit(1).maybeSingle()).data?.id || '00000000-0000-0000-0000-000000000000',
        })
        .select('id')
        .single();

      if (jeErr) {
        console.error('Failed to create opening balance journal entry:', jeErr);
      } else if (je) {
        // إنشاء سطور القيد مع جميع الحقول المطلوبة
        const lines: any[] = [];
        
        if (params.openingBalance > 0) {
          // مدين: الحساب الجديد
          lines.push({
            company_id: params.companyId,
            journal_entry_id: je.id,
            account_id: newAccount.id,
            account_code: params.code,
            account_name: params.name,
            debit: params.openingBalance,
            credit: 0,
            description: 'رصيد افتتاحي',
          });
          // دائن: رأس المال (إذا وجد)
          if (capitalAcc) {
            lines.push({
              company_id: params.companyId,
              journal_entry_id: je.id,
              account_id: capitalAcc.id,
              account_code: capitalAcc.code,
              account_name: capitalAcc.name,
              debit: 0,
              credit: params.openingBalance,
              description: 'رصيد افتتاحي',
            });
          }
        } else {
          // دائن: الحساب الجديد
          lines.push({
            company_id: params.companyId,
            journal_entry_id: je.id,
            account_id: newAccount.id,
            account_code: params.code,
            account_name: params.name,
            debit: 0,
            credit: Math.abs(params.openingBalance),
            description: 'رصيد افتتاحي',
          });
          // مدين: رأس المال (إذا وجد)
          if (capitalAcc) {
            lines.push({
              company_id: params.companyId,
              journal_entry_id: je.id,
              account_id: capitalAcc.id,
              account_code: capitalAcc.code,
              account_name: capitalAcc.name,
              debit: Math.abs(params.openingBalance),
              credit: 0,
              description: 'رصيد افتتاحي',
            });
          }
        }

        if (lines.length > 0) {
          const { error: jlErr } = await s.from('journal_lines').insert(lines);
          if (jlErr) {
            console.error('Failed to insert opening balance journal lines:', jlErr);
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
