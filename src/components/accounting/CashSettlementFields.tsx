'use client';

import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { roundMoney } from '@/lib/utils';

export interface BankSafeOption {
  id: string;
  name: string;
  type?: string;
}

interface CashSettlementFieldsProps {
  mode: 'collect' | 'pay' | 'refund';
  total: number;
  amount: string;
  bankSafeId: string;
  banks: BankSafeOption[];
  money: (n: number) => string;
  onAmountChange: (value: string) => void;
  onBankChange: (value: string) => void;
}

const COPY = {
  collect: {
    title: 'التحصيل عند الإصدار',
    hint: 'فاتورة آجلة تبقى ذمة على العميل. التحصيل النقدي أو البنكي ينشئ سند قبض في نفس الترحيل، والباقي يبقى مستحقاً.',
    none: 'آجل (بدون تحصيل الآن)',
    full: 'تحصيل كامل نقداً / بنك',
    partial: 'تحصيل جزئي',
    amount: 'مبلغ التحصيل',
    remain: 'المتبقي على العميل',
  },
  pay: {
    title: 'السداد عند الإصدار',
    hint: 'فاتورة آجلة تبقى ذمة للمورد. السداد من خزينة أو بنك ينشئ سند صرف في نفس الترحيل، والباقي يبقى مستحقاً.',
    none: 'آجل (بدون سداد الآن)',
    full: 'سداد كامل نقداً / بنك',
    partial: 'سداد جزئي',
    amount: 'مبلغ السداد',
    remain: 'المتبقي للمورد',
  },
  refund: {
    title: 'الرد النقدي مع المرتجع',
    hint: 'إن كان الأصل محصّلاً/مسدداً يمكن رد المبلغ من الخزينة (مبيعات) أو قبض الرد من المورد (مشتريات). إن تُرك صفراً يبقى الرصيد في الذمة.',
    none: 'بدون رد نقدي (يبقى في الذمة)',
    full: 'رد كامل لقيمة المرتجع',
    partial: 'رد جزئي',
    amount: 'مبلغ الرد',
    remain: 'المتبقي في الذمة',
  },
};

export function CashSettlementFields({
  mode, total, amount, bankSafeId, banks, money, onAmountChange, onBankChange,
}: CashSettlementFieldsProps) {
  const copy = COPY[mode];
  const numeric = Number(amount) || 0;
  const roundedTotal = roundMoney(total);
  const remaining = Math.max(0, roundMoney(total - numeric));
  const method = numeric <= 0 ? 'none' : (Math.abs(numeric - total) < 0.005 ? 'full' : 'partial');

  const setMethod = (value: string) => {
    if (value === 'none') onAmountChange('0');
    // الكامل دائماً الإجمالي المقرّب بمنزلتين عشريتين (المبلغ غير المقرّب
    // يُرفض في التحقق، والأكبر من الإجمالي يرفضه السيرفر).
    else if (value === 'full') onAmountChange(roundedTotal > 0 ? String(roundedTotal) : '0');
    // الجزئي لا يتجاوز الإجمالية مهما كُتب في الحقل.
    else onAmountChange(numeric > 0 && numeric < total ? String(roundMoney(Math.min(numeric, roundedTotal))) : '');
  };

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-4 space-y-3">
      <div>
        <h4 className="text-sm font-bold text-text-primary">{copy.title}</h4>
        <p className="text-xs text-text-muted mt-1 leading-6">{copy.hint}</p>
      </div>
      <Select
        label="الطريقة"
        value={method}
        onChange={setMethod}
        options={[
          { value: 'none', label: copy.none },
          { value: 'full', label: copy.full },
          { value: 'partial', label: copy.partial },
        ]}
      />
      {method !== 'none' && (
        <>
          <Input
            label={copy.amount}
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
          />
          <Select
            label="الخزينة / البنك"
            value={bankSafeId}
            onChange={onBankChange}
            options={[
              { value: '', label: '— اختر الخزينة أو البنك —' },
              ...banks.map((bank) => ({
                value: bank.id,
                label: `${bank.name}${bank.type === 'safe' ? ' (خزينة)' : bank.type === 'bank' ? ' (بنك)' : ''}`,
              })),
            ]}
          />
          <div className="flex justify-between text-xs text-text-secondary">
            <span>{copy.remain}</span>
            <span className="font-bold">{money(remaining)}</span>
          </div>
        </>
      )}
    </div>
  );
}
