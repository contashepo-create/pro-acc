'use client';

import { useState, useEffect } from 'react';
import { Save, Building2, Phone, Mail, CreditCard, Globe } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';

const DEFAULTS: Record<string, string> = {
  app_name: 'برو أكاونت',
  app_name_en: 'ProAccount',
  app_version: '1.0.0',
  developer_name: 'ContaShepo',
  support_email: 'contashepo@gmail.com',
  support_phone: '+966500000000',
  support_whatsapp: '+966500000000',
  support_telegram: 'contashepo',
  support_website: 'https://pro-acc.vercel.app',
  payment_info: 'يمكن الدفع عبر التحويل البنكي أو الوسائل الإلكترونية',
  payment_bank_name: '',
  payment_iban: '',
  payment_stc_pay: '',
  footer_text: '© 2026 برو أكاونت - جميع الحقوق محفوظة',
};

export default function AppSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ ...DEFAULTS });

  useEffect(() => {
    fetch('/api/admin/app-settings')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setForm({ ...DEFAULTS, ...d.data });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/app-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (d.success) toast.success('تم حفظ الإعدادات بنجاح');
      else toast.error(d.message || 'فشل الحفظ');
    } catch { toast.error('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  if (loading) return <div className="p-6 text-center text-text-secondary">جاري التحميل...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">إعدادات التطبيق العامة</h1>
          <p className="text-text-secondary text-sm mt-1">تحكم في معلومات التواصل والدفع والعلامة التجارية</p>
        </div>
        <Button onClick={handleSave} disabled={saving} leftIcon={<Save size={18} />}>
          {saving ? 'جاري الحفظ...' : 'حفظ'}
        </Button>
      </div>

      {/* Branding */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={20} className="text-accent" />
          <h2 className="text-lg font-bold text-text-primary">العلامة التجارية</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="اسم البرنامج (عربي)" value={form.app_name || ''} onChange={(e: any) => set('app_name', e.target.value)} />
          <Input label="اسم البرنامج (إنجليزي)" value={form.app_name_en || ''} onChange={(e: any) => set('app_name_en', e.target.value)} />
          <Input label="إصدار البرنامج" value={form.app_version || ''} onChange={(e: any) => set('app_version', e.target.value)} />
          <Input label="اسم المطور" value={form.developer_name || ''} onChange={(e: any) => set('developer_name', e.target.value)} />
        </div>
      </Card>

      {/* Contact */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Mail size={20} className="text-accent" />
          <h2 className="text-lg font-bold text-text-primary">معلومات التواصل</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="البريد الإلكتروني" type="email" value={form.support_email || ''} onChange={(e: any) => set('support_email', e.target.value)} />
          <Input label="رقم الهاتف" value={form.support_phone || ''} onChange={(e: any) => set('support_phone', e.target.value)} dir="ltr" />
          <Input label="واتساب" value={form.support_whatsapp || ''} onChange={(e: any) => set('support_whatsapp', e.target.value)} dir="ltr" />
          <Input label="تيليجرام" value={form.support_telegram || ''} onChange={(e: any) => set('support_telegram', e.target.value)} dir="ltr" />
          <Input label="الموقع الإلكتروني" value={form.support_website || ''} onChange={(e: any) => set('support_website', e.target.value)} dir="ltr" className="col-span-2" />
        </div>
      </Card>

      {/* Payment */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <CreditCard size={20} className="text-accent" />
          <h2 className="text-lg font-bold text-text-primary">معلومات الدفع</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="اسم البنك" value={form.payment_bank_name || ''} onChange={(e: any) => set('payment_bank_name', e.target.value)} />
          <Input label="رقم الآيبان (IBAN)" value={form.payment_iban || ''} onChange={(e: any) => set('payment_iban', e.target.value)} dir="ltr" />
          <Input label="STC Pay" value={form.payment_stc_pay || ''} onChange={(e: any) => set('payment_stc_pay', e.target.value)} dir="ltr" />
          <Textarea label="ملاحظات الدفع" value={form.payment_info || ''} onChange={(e: any) => set('payment_info', e.target.value)} className="col-span-2" />
        </div>
      </Card>

      {/* Footer */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Globe size={20} className="text-accent" />
          <h2 className="text-lg font-bold text-text-primary">التذييل</h2>
        </div>
        <Textarea label="نص التذييل" value={form.footer_text || ''} onChange={(e: any) => set('footer_text', e.target.value)} />
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} leftIcon={<Save size={18} />}>
          {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
        </Button>
      </div>
    </div>
  );
}
