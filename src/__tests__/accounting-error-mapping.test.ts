import {
  handleApiError,
  accountingRpcStatus,
  serverError,
} from '@/lib/api-helpers';
import { roundMoney } from '@/lib/utils';
import { NextResponse } from 'next/server';

/** تسلسل رسائل الرفض الثابتة من دوال RPC الذرية (عينة من كل عائلة). */
const SAMPLE_RPC_REJECTIONS = [
  'مبلغ التحصيل غير صالح',
  'فاتورة البيع غير صالحة للتخصيص',
  'مجموع التخصيصات يتجاوز مبلغ السند',
  'بيانات سند الصرف غير صالحة',
  'الرصيد غير كاف للصرف',
  'التخصيص يتجاوز المتبقي على الفاتورة',
  'مبلغ السداد يتجاوز المستحق للمورد',
  'حسابات المبيعات غير مكتملة',
  'البنك أو الخزينة غير موجود',
  'المستخدم غير صالح',
  'حسابات المخزون (1170) أو التكلفة (5100) غير مكتملة',
  'بيانات التحويل غير صالحة',
  'لا يمكن إلغاء سلفة الموظف بعد تسديد جزء منها',
];

describe('accountingRpcStatus', () => {
  it.each(SAMPLE_RPC_REJECTIONS)('يعترف برسالة الرفض المحاسبي: %s', (message) => {
    expect(accountingRpcStatus(message)).toBe(400);
  });

  it('يعترف بالرسائل المُكملة بمعاملات من Postgres', () => {
    expect(accountingRpcStatus('حساب مصروف «5400» غير موجود')).toBe(400);
    expect(accountingRpcStatus('الصنف المخزني PRD1 غير نشط')).toBe(400);
    expect(accountingRpcStatus('الكمية غير متوفرة في المخزون للصنف PRD1 (المتاح 3)')).toBe(400);
  });

  it('يتجاهل رسائل قاعدة البيانات غير المعروفة (تبقى 500)', () => {
    expect(accountingRpcStatus('relation "x" does not exist')).toBeNull();
    expect(accountingRpcStatus('syntax error at or near "from"')).toBeNull();
    expect(accountingRpcStatus('')).toBeNull();
    // رسالة عربية لكنها ليست من القائمة — لا تُعرض للعميل
    expect(accountingRpcStatus('duplicate key value violates constraint')).toBeNull();
  });
});

describe('handleApiError — ترجمة أخطاء قاعدة البيانات المحاسبية', () => {
  it.each(SAMPLE_RPC_REJECTIONS)('يرجع الرفض المحاسبي 400 بنصه الحقيقي بدل 500: %s', (message) => {
    const res = handleApiError({ message });
    expect(res.status).toBe(400);
  });

  it('يرجع الرسائل المُكملة بمعاملات كرفض أعمال 400', () => {
    const res = handleApiError({ message: 'الكمية غير متوفرة في المخزون للصنف PRD1 (المتاح 3)' });
    expect(res.status).toBe(400);
  });

  it('يرجم PGRST202 (دالة غير مثبتة — ميجريشنز معلقة) إلى 503 برسالة إرشادية', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = handleApiError({
        code: 'PGRST202',
        message: 'Could not find the function public.create_sales_invoice_atomic(p_company_id, ...) in the schema cache',
      });
      expect(res.status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });

  it('يرجم "function public.x does not exist" من المحرك مباشرة إلى 503', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = handleApiError(new Error('function public.create_voucher_receipt_atomic(uuid,uuid,uuid,text,text,numeric,uuid,text,jsonb,boolean,boolean,uuid,uuid,uuid,text,numeric) does not exist'));
      expect(res.status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });

  it('يبقي الخطأ غير المعروف 500 عاماً بدون تسريب تفاصيل قاعدة البيانات', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = handleApiError({ message: 'relation "invoices" does not exist', details: 'schema public' });
      expect(res.status).toBe(500);
      const body = await (res as unknown as NextResponse).json();
      expect(body.message).toBe('حدث خطأ في الخادم');
      expect(JSON.stringify(body)).not.toContain('invoices');
    } finally {
      spy.mockRestore();
    }
  });

  it('يرجم سنة مالية مقفلة إلى 409 (السلوك الحالي محفوظ)', () => {
    const res = handleApiError({ message: 'لا يمكن الترحيل إلى سنة مالية مقفلة' });
    expect(res.status).toBe(409);
  });

  it('serverError يبقى يعمل كما هو', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(serverError(new Error('boom')).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('roundMoney', () => {
  it('يقرّب نصف الخانة نحو الأعلى مطابقةً لـ ROUND في PostgreSQL', () => {
    expect(roundMoney(100.005)).toBe(100.01);
    expect(roundMoney(0.375)).toBe(0.38);
    expect(roundMoney(4.9995)).toBe(5);
    expect(roundMoney(115.00575)).toBe(115.01);
  });

  it('يعالج انحراف الفاصلة العائمة', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(33.33 * 0.15)).toBe(5);
    expect(roundMoney(105.55 * 0.14)).toBe(14.78);
  });

  it('يحافظ على السالب والقيم الحدية', () => {
    expect(roundMoney(-2.675)).toBe(-2.68);
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(Number('x'))).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
  });
});
