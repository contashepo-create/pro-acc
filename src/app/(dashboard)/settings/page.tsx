'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Save, Palette, Sun, Moon, Check, Info, CreditCard, Mail, Phone, 
  Building2, Calendar, AlertCircle, Bot, Send, RefreshCw, Copy, ExternalLink,
  Plus, Users as UsersIcon, Shield, Trash2, MapPin
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { useThemeStore } from '@/store/theme-store';
import { useAuthStore } from '@/store/auth-store';
import { themes } from '@/lib/themes';

// ==================== مكون إدارة المستخدمين داخل الإعدادات ====================
function SettingsUsersSection() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const [maxUsers, setMaxUsers] = useState<number | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [form, setForm] = useState<any>({
    name: '', email: '', password: '', role: 'accountant',
    phone: '', birth_date: '', city: '',
  });

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/company/users');
      const json = await res.json();
      if (json.success) {
        setUsers(json.data?.users || []);
        setCurrentCount(json.data?.currentCount || 0);
        setMaxUsers(json.data?.maxUsers ?? null);
        setPlanName(json.data?.planName || null);
      }
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  const canAdd = maxUsers === null || currentCount < maxUsers;

  const handleSave = async () => {
    if (!form.name || !form.email || !form.password) {
      setSaveError('الاسم والبريد وكلمة المرور مطلوبة');
      return;
    }
    if (form.password.length < 6) {
      setSaveError('كلمة المرور 6 أحرف على الأقل');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const res = await fetch('/api/company/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, email: form.email, password: form.password, role: form.role,
          phone: form.phone || undefined, birth_date: form.birth_date || undefined, city: form.city || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({ name: '', email: '', password: '', role: 'accountant', phone: '', birth_date: '', city: '' });
        fetchUsers();
      } else setSaveError(json.message || 'فشل');
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleDelete = async (u: any) => {
    if (!confirm(`حذف المستخدم "${u.name}"؟`)) return;
    try {
      const res = await fetch(`/api/company/users/${u.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) fetchUsers();
      else alert(json.message || 'فشل الحذف');
    } catch { alert('خطأ في الاتصال'); }
  };

  const handleToggleActive = async (u: any) => {
    try {
      await fetch(`/api/company/users/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      fetchUsers();
    } catch {}
  };

  return (
    <div className="space-y-4">
      {/* معلومات الحد */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <UsersIcon size={20} className="text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold">المستخدمين في شركتك</h3>
              <p className="text-sm text-gray-500">
                {currentCount} مستخدم {maxUsers ? `/ ${maxUsers} (باقة ${planName || 'الحالية'})` : '(بدون حد)'}
              </p>
            </div>
          </div>
          <Button 
            onClick={() => {
              if (!canAdd) {
                alert(`تم الوصول للحد الأقصى (${maxUsers}) في باقة "${planName}". يرجى الترقية.`);
                return;
              }
              setShowModal(true);
            }}
            leftIcon={<Plus size={16} />}
          >
            إضافة مستخدم
          </Button>
        </div>
        {maxUsers && currentCount >= maxUsers && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2 text-red-700 text-sm flex items-center gap-2">
            <AlertCircle size={16} />
            تم الوصول للحد الأقصى. <button onClick={() => router.push('/subscription')} className="underline font-medium">ترقية الباقة</button>
          </div>
        )}
      </Card>

      {/* قائمة المستخدمين */}
      <Card padding="none">
        {loading ? (
          <div className="p-8 text-center text-gray-500">جاري التحميل...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <UsersIcon size={40} className="mx-auto mb-2 text-gray-300" />
            <p>لا يوجد مستخدمون. أضف أول مستخدم لفريقك.</p>
          </div>
        ) : (
          <div className="divide-y">
            {users.map((u) => (
              <div key={u.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
                    {u.name?.charAt(0) || '?'}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{u.name}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                    <div className="flex gap-2 mt-1">
                      <Badge className={u.role === 'admin' ? 'bg-red-100 text-red-700 text-xs border-red-200 border' : u.role === 'manager' ? 'bg-blue-100 text-blue-700 text-xs border-blue-200 border' : 'bg-green-100 text-green-700 text-xs border-green-200 border'}>
                        {u.role === 'admin' ? 'مدير' : u.role === 'manager' ? 'مدير' : u.role === 'accountant' ? 'محاسب' : 'مشرف'}
                      </Badge>
                      <Badge variant={u.is_active ? 'success' : 'danger'} className="text-xs">
                        {u.is_active ? 'نشط' : 'معطل'}
                      </Badge>
                      {u.city && (
                        <span className="text-xs text-gray-400 flex items-center gap-0.5">
                          <MapPin size={10} /> {u.city}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleToggleActive(u)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title={u.is_active ? 'تعطيل' : 'تفعيل'}>
                    <Shield size={16} />
                  </button>
                  <button onClick={() => handleDelete(u)} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="حذف">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* رابط لصفحة الصلاحيات الكاملة */}
      <Card className="p-4 bg-purple-50 border-purple-200">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-purple-800">إدارة الصلاحيات المتقدمة</h4>
            <p className="text-sm text-purple-600">التحكم في صلاحيات كل مستخدم والوحدات المتاحة له</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/permissions')}>
            إدارة الصلاحيات
          </Button>
        </div>
      </Card>

      {/* نافذة الإضافة */}
      <Modal 
        isOpen={showModal} 
        onClose={() => { setShowModal(false); setSaveError(''); }} 
        title="إضافة مستخدم جديد" 
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الإضافة...' : 'إضافة'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded p-2 text-sm text-blue-700 flex items-center gap-2">
            <Shield size={14} />
            المستخدم سيكون مرتبطاً بشركتك فقط
          </div>
          {saveError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">{saveError}</div>}
          
          <div className="grid grid-cols-2 gap-4">
            <Input label="الاسم *" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <Input label="البريد *" type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} dir="ltr" />
            <Input label="كلمة المرور *" type="password" value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} dir="ltr" />
            <Select label="الدور *" value={form.role} onChange={(v) => setForm({...form, role: v})} options={[
              { value: 'admin', label: 'مدير النظام' },
              { value: 'manager', label: 'مدير' },
              { value: 'accountant', label: 'محاسب' },
              { value: 'supervisor', label: 'مشرف' },
            ]} />
          </div>
          
          <div className="border-t pt-3">
            <p className="text-xs text-gray-500 mb-2">معلومات إضافية (اختياري)</p>
            <div className="grid grid-cols-3 gap-3">
              <Input label="الجوال" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} dir="ltr" />
              <Input label="المدينة" value={form.city} onChange={(e) => setForm({...form, city: e.target.value})} />
              <Input label="تاريخ الميلاد" type="date" value={form.birth_date} onChange={(e) => setForm({...form, birth_date: e.target.value})} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState('general');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const { themeId, isDark, setTheme, toggleMode } = useThemeStore();
  const { user, company } = useAuthStore();

  // Company form state
  const [companyName, setCompanyName] = useState('');
  const [registration, setRegistration] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');

  // Accounting settings
  const [fiscalStart, setFiscalStart] = useState('');
  const [decimalPlaces, setDecimalPlaces] = useState('2');
  const [vatRate, setVatRate] = useState('15');
  
  // Notifications
  const [notifInvoice, setNotifInvoice] = useState(true);
  const [notifDue, setNotifDue] = useState(true);
  const [notifStock, setNotifStock] = useState(true);
  const [notifVoucher, setNotifVoucher] = useState(false);

  // Subscription state
  const [subscription, setSubscription] = useState<any>(null);
  const [subLoading, setSubLoading] = useState(true);

  // Telegram Settings State
  const [telegramAllowed, setTelegramAllowed] = useState(true);
  const [telegramConfig, setTelegramConfig] = useState<any>({
    chat_id: '',
    is_enabled: false,
    notify_invoices: true,
    notify_cash_transactions: true,
    notify_user_logins: true,
    approvals_enabled: false,
    approval_threshold: '5000'
  });
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string>(''); // '', 'pending', 'accepted', 'rejected', 'expired'
  const [testLoading, setTestLoading] = useState(false);

  // تليجرام الموحد للمنصة - يتم تعديله من خلال متغيرات المطور
  const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'Proaccwebcontroller_bot';

  useEffect(() => {
    // Load company data and settings
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const c = d.data?.company;
          if (c) {
            setCompanyName(c.name || '');
            setRegistration(c.commercial_registration || c.registrationNumber || '');
            setTaxNumber(c.tax_number || c.taxNumber || '');
            setPhone(c.phone || '');
            setEmail(c.email || '');
            setAddress(c.address || '');
          }
          const s = d.data?.settings || {};
          if (s.fiscal_start) setFiscalStart(s.fiscal_start);
          if (s.decimal_places) setDecimalPlaces(s.decimal_places);
          if (s.vat_rate) setVatRate(s.vat_rate);
          if (s.notif_invoice !== undefined) setNotifInvoice(s.notif_invoice === 'true');
          if (s.notif_due !== undefined) setNotifDue(s.notif_due === 'true');
          if (s.notif_stock !== undefined) setNotifStock(s.notif_stock === 'true');
          if (s.notif_voucher !== undefined) setNotifVoucher(s.notif_voucher === 'true');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Load subscription data
    fetch('/api/auth/subscription-status')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSubscription(d.data);
      })
      .catch(() => {})
      .finally(() => setSubLoading(false));
  }, []);

  // Load Telegram Configurations on tab click
  useEffect(() => {
    if (tab === 'telegram') {
      fetch('/api/settings/telegram')
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            setTelegramAllowed(d.data.isAllowed);
            if (d.data.config) {
              setTelegramConfig({
                ...d.data.config,
                approval_threshold: String(d.data.config.approval_threshold || '5000')
              });
            }
          }
        })
        .catch(() => {});
    }
  }, [tab]);

  // Real-time polling for Telegram Interactive Test Run
  useEffect(() => {
    if (testStatus !== 'pending' || !testRunId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/settings/telegram/test?test_run_id=${testRunId}`);
        const data = await res.json();
        if (data.success && data.data) {
          const status = data.data.status;
          if (status !== 'pending') {
            setTestStatus(status);
            clearInterval(interval);
          }
        }
      } catch (e) {
        console.error('Telegram polling failed:', e);
      }
    }, 2000);

    // Expire the test run after 60 seconds to prevent infinite loops
    const timeout = setTimeout(() => {
      setTestStatus((current) => {
        if (current === 'pending') {
          clearInterval(interval);
          return 'expired';
        }
        return current;
      });
    }, 60000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [testStatus, testRunId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleSaveCompany = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          commercial_registration: registration,
          tax_number: taxNumber,
          phone: phone,
          email: email,
          address: address,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ إعدادات الشركة بنجاح');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    }
  };

  const handleSaveAccounting = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            fiscal_start: fiscalStart,
            decimal_places: decimalPlaces,
          }
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ الإعدادات المحاسبية');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    }
  };

  const handleSaveTax = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            vat_rate: vatRate,
          }
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ إعدادات الضرائب');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    }
  };

  const handleSaveNotifications = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            notif_invoice: String(notifInvoice),
            notif_due: String(notifDue),
            notif_stock: String(notifStock),
            notif_voucher: String(notifVoucher),
          }
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ إعدادات الإشعارات');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    }
  };

  const handleSaveTelegram = async () => {
    setTelegramLoading(true);
    try {
      const res = await fetch('/api/settings/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telegramConfig),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ إعدادات تيليجرام بنجاح');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleStartTest = async () => {
    if (!telegramConfig.chat_id) {
      showToast('يرجى تعيين وحفظ "معرف الدردشة" (Chat ID) أولاً قبل البدء بالفحص');
      return;
    }
    setTestLoading(true);
    setTestStatus('');
    setTestRunId(null);
    try {
      // First save settings to ensure DB is aligned
      await fetch('/api/settings/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telegramConfig),
      });

      const res = await fetch('/api/settings/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setTestRunId(data.data.testRunId);
        setTestStatus('pending');
        showToast('تم إرسال رسالة الفحص لتيليجرام بنجاح');
      } else {
        showToast(data.message || 'فشل البدء بالفحص التفاعلي');
      }
    } catch {
      showToast('حدث خطأ في الاتصال بالشبكة');
    } finally {
      setTestLoading(false);
    }
  };

  const currentTheme = themes.find((t) => t.id === themeId) || themes[0];

  return (
    <div className="space-y-6">
      <PageHeader title="الإعدادات" description="إعدادات الشركة والنظام والربط التقني" />

      <Tabs items={[
        { id: 'general', label: 'عام' },
        { id: 'users', label: 'المستخدمين 👥' },
        { id: 'accounting', label: 'محاسبة' },
        { id: 'tax', label: 'ضرائب' },
        { id: 'subscription', label: 'الاشتراك' },
        { id: 'about', label: 'حول البرنامج' },
        { id: 'appearance', label: 'المظهر' },
        { id: 'notifications', label: 'إشعارات' },
        { id: 'telegram', label: 'تيليجرام 🤖' },
      ]} activeTab={tab} onChange={setTab} />

      {/* General — Company Info */}
      {tab === 'general' && (
        <Card title="معلومات الشركة">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="اسم الشركة" value={companyName} onChange={(e: any) => setCompanyName(e.target.value)} className="col-span-2" />
            <Input label="رقم السجل التجاري" value={registration} onChange={(e: any) => setRegistration(e.target.value)} />
            <Input label="الرقم الضريبي" value={taxNumber} onChange={(e: any) => setTaxNumber(e.target.value)} />
            <Input label="الهاتف" value={phone} onChange={(e: any) => setPhone(e.target.value)} />
            <Input label="البريد الإلكتروني" type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} />
            <Input label="العنوان" value={address} onChange={(e: any) => setAddress(e.target.value)} className="col-span-2" />
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveCompany} leftIcon={<Save size={16} />}>حفظ الإعدادات</Button>
          </div>
        </Card>
      )}

      {/* Users Management */}
      {tab === 'users' && (
        <SettingsUsersSection />
      )}

      {/* Accounting */}
      {tab === 'accounting' && (
        <Card title="الإعدادات المحاسبية">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="بداية السنة المالية" type="date" value={fiscalStart} onChange={(e:any)=>setFiscalStart(e.target.value)} />
            <Input label="عدد المنازل العشرية" type="number" value={decimalPlaces} onChange={(e:any)=>setDecimalPlaces(e.target.value)} />
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveAccounting} leftIcon={<Save size={16} />}>حفظ</Button>
          </div>
        </Card>
      )}

      {/* Tax */}
      {tab === 'tax' && (
        <Card title="إعدادات الضرائب">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="نسبة ضريبة القيمة المضافة (%)" type="number" value={vatRate} onChange={(e:any)=>setVatRate(e.target.value)} />
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveTax} leftIcon={<Save size={16} />}>حفظ</Button>
          </div>
        </Card>
      )}

      {/* Subscription */}
      {tab === 'subscription' && (
        <div className="space-y-4">
          {subLoading ? (
            <Card><div className="text-center py-8 text-text-muted">جاري التحميل...</div></Card>
          ) : subscription ? (
            <>
              <Card title="حالة الاشتراك">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                    <span className="text-sm text-text-muted">الباقة الحالية</span>
                    <span className="font-bold text-accent">{subscription.plan_name || 'تجريبي'}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                    <span className="text-sm text-text-muted">الحالة</span>
                    <span className={`font-bold ${subscription.is_expired ? 'text-danger' : 'text-success'}`}>
                      {subscription.is_expired ? 'منتهي' : 'نشط'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                    <span className="text-sm text-text-muted">تاريخ الانتهاء</span>
                    <span className="font-medium text-text-primary" dir="ltr">{subscription.end_date}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                    <span className="text-sm text-text-muted">الأيام المتبقية</span>
                    <span className={`font-bold ${subscription.days_remaining <= 7 ? 'text-warning' : 'text-success'}`}>
                      {subscription.days_remaining} يوم
                    </span>
                  </div>
                  {subscription.is_expiring_soon && !subscription.is_expired && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm">
                      <AlertCircle size={16} />
                      اشتراكك ينتهي قريباً — يرجى التجديد
                    </div>
                  )}
                  <Button onClick={() => window.location.href = '/subscription'} leftIcon={<CreditCard size={16} />}>
                    ترقية / تجديد الاشتراك
                  </Button>
                </div>
              </Card>
            </>
          ) : (
            <Card><div className="text-center py-8 text-text-muted">لا يوجد اشتراك. <a href="/subscription" className="text-accent">اشترك الآن</a></div></Card>
          )}
        </div>
      )}

      {/* About */}
      {tab === 'about' && (
        <Card title="حول البرنامج">
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-accent/5">
              <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
                <Building2 size={24} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-text-primary">برو أكاوننت — AccWeb</h3>
                <p className="text-xs text-text-muted">نظام محاسبة متكامل — الإصدار 1.0</p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-bold text-text-secondary mb-2">بيانات حسابك</h4>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Mail size={16} className="text-text-muted" />
                <span className="text-sm text-text-muted">البريد:</span>
                <span className="text-sm font-medium text-text-primary" dir="ltr">{user?.email || '—'}</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Info size={16} className="text-text-muted" />
                <span className="text-sm text-text-muted">الاسم:</span>
                <span className="text-sm font-medium text-text-primary">{user?.name || '—'}</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Building2 size={16} className="text-text-muted" />
                <span className="text-sm text-text-muted">الشركة:</span>
                <span className="text-sm font-medium text-text-primary">{company?.name || '—'}</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <CreditCard size={16} className="text-text-muted" />
                <span className="text-sm text-text-muted">رقم الاشتراك:</span>
                <span className="text-sm font-medium text-text-primary font-mono" dir="ltr">
                  {subscription ? subscription.id?.substring(0, 8) : '—'}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-4 border-t border-border">
              <h4 className="text-sm font-bold text-text-secondary mb-2">للتواصل والدعم</h4>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Mail size={16} className="text-accent" />
                <span className="text-sm text-text-muted">البريد:</span>
                <a href="mailto:conta.moha@gmail.com" className="text-sm text-accent hover:underline" dir="ltr">conta.moha@gmail.com</a>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Phone size={16} className="text-accent" />
                <span className="text-sm text-text-muted">تيليجرام:</span>
                <a href="https://t.me/contashepo" className="text-sm text-accent hover:underline" dir="ltr">@contashepo</a>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-bg-secondary text-center">
              <p className="text-xs text-text-muted">
                عند التواصل مع الدعم، يرجى إرسال رقم اشتراكك وبريدك الإلكتروني لتسهيل المساعدة
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Appearance */}
      {tab === 'appearance' && (
        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">الوضع</h3>
                <p className="text-sm text-text-muted mt-0.5">
                  {isDark ? 'وضع داكن — ألوان عميقة مريحة للعين' : 'وضع فاتح — ألوان نقية مناسبة للإضاءة القوية'}
                </p>
              </div>
              <button
                onClick={toggleMode}
                className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${isDark ? 'bg-accent/30' : 'bg-border'}`}
              >
                <div
                  className={`absolute top-1 w-6 h-6 rounded-full bg-accent flex items-center justify-center transition-all duration-300 shadow-md ${isDark ? 'right-1' : 'right-9'}`}
                >
                  {isDark ? <Moon size={12} className="text-white" /> : <Sun size={12} className="text-white" />}
                </div>
              </button>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Palette size={18} className="text-accent" />
              <h3 className="text-base font-semibold">الثيم</h3>
            </div>
            <p className="text-sm text-text-muted mb-4">
              اختر لوحة الألوان الأساسية.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {themes.map((theme) => {
                const isActive = theme.id === themeId;
                const previewAccent = isDark ? theme.dark['--color-accent'] : theme.light['--color-accent'];
                const previewCard = isDark ? theme.dark['--color-bg-card'] : theme.light['--color-bg-card'];
                const previewBg = isDark ? theme.dark['--color-bg-primary'] : theme.light['--color-bg-primary'];
                const previewBorder = isDark ? theme.dark['--color-border'] : theme.light['--color-border'];

                return (
                  <button
                    key={theme.id}
                    onClick={() => setTheme(theme.id)}
                    className={`relative p-3 rounded-xl border-2 text-right transition-all duration-200 hover:-translate-y-0.5 ${isActive ? 'border-accent shadow-md' : 'border-border hover:border-border-light'}`}
                    style={{ background: previewCard }}
                  >
                    {isActive && (
                      <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                    <div className="flex gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg" style={{ background: previewAccent }} />
                      <div>
                        <div className="text-sm font-semibold text-text-primary">{theme.name}</div>
                        <div className="text-[11px] text-text-muted">{theme.nameEn}</div>
                      </div>
                    </div>
                    <p className="text-xs text-text-muted leading-relaxed mb-2">{theme.description}</p>
                    <div className="h-8 rounded-lg flex gap-1 p-1" style={{ background: previewBg, border: `1px solid ${previewBorder}` }}>
                      <div className="flex-1 rounded" style={{ background: previewCard }} />
                      <div className="w-6 rounded" style={{ background: previewAccent }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Notifications */}
      {tab === 'notifications' && (
        <Card title="إشعارات النظام">
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" checked={notifInvoice} onChange={(e)=>setNotifInvoice(e.target.checked)} />
              <span className="text-sm">إشعار عند إضافة فاتورة جديدة</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" checked={notifDue} onChange={(e)=>setNotifDue(e.target.checked)} />
              <span className="text-sm">إشعار عند استحقاق فاتورة</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" checked={notifStock} onChange={(e)=>setNotifStock(e.target.checked)} />
              <span className="text-sm">إشعار عند انخفاض رصيد المخزون</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" checked={notifVoucher} onChange={(e)=>setNotifVoucher(e.target.checked)} />
              <span className="text-sm">إشعار عند إنشاء سند قبض/صرف</span>
            </label>
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveNotifications} leftIcon={<Save size={16} />}>حفظ الإشعارات</Button>
          </div>
        </Card>
      )}

      {/* Telegram Tab */}
      {tab === 'telegram' && (
        <div className="space-y-6">
          {!telegramAllowed ? (
            <Card>
              <div className="text-center py-10 px-4">
                <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
                  <Bot size={32} className="text-warning" />
                </div>
                <h3 className="text-lg font-bold text-text-primary mb-2">ميزة حصرية بالباقة الاحترافية 🚀</h3>
                <p className="text-sm text-text-muted max-w-md mx-auto mb-6 leading-relaxed">
                  ميزة ربط تليجرام التفاعلية والموافقات المباشرة عبر الجوال متوفرة للمشتركين في الباقة الاحترافية أو باقة المؤسسات فقط.
                </p>
                <Button onClick={() => setTab('subscription')} leftIcon={<CreditCard size={16} />}>
                  ترقية اشتراكي الآن
                </Button>
              </div>
            </Card>
          ) : (
            <>
              {/* Detailed Step-by-Step Customer Interactive Guide Card */}
              <Card title="دليل تفعيل البوت المحاسبي التفاعلي للعملاء 📖">
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary leading-relaxed">
                    برجاء اتباع الخطوات الـ 3 البسيطة التالية بدقة لربط حسابك وتفعيل الإشعارات والموافقات الفورية على جوالك:
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2 flex flex-col justify-between">
                      <div>
                        <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-sm mb-2">1</div>
                        <h4 className="text-sm font-bold text-text-primary">البحث عن البوت الرسمي</h4>
                        <p className="text-xs text-text-muted leading-relaxed">
                          افتح تطبيق تلغرام وابحث عن البوت الرسمي للمنصة:
                          <span className="block mt-1 font-mono text-accent font-bold">@{TELEGRAM_BOT_USERNAME}</span>
                        </p>
                      </div>
                      <a 
                        href={`https://t.me/${TELEGRAM_BOT_USERNAME}`} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="mt-3 text-xs text-accent font-bold hover:underline inline-flex items-center gap-1"
                      >
                        فتح البوت في تليجرام <ExternalLink size={12} />
                      </a>
                    </div>

                    <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2">
                      <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-sm mb-2">2</div>
                      <h4 className="text-sm font-bold text-text-primary">الحصول على المعرف الرقمي</h4>
                      <p className="text-xs text-text-muted leading-relaxed">
                        اضغط على زر <b>ابدأ (Start)</b> أو أرسل أمر <code className="font-mono text-accent">/start</code> داخل المحادثة.
                        <br />
                        سيقوم البوت بالترحيب بك وإرسال <b>معرّف الدردشة الرقمي الفريد</b> الخاص بك فوراً على الشاشة.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2">
                      <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-sm mb-2">3</div>
                      <h4 className="text-sm font-bold text-text-primary">ربط المعرّف في الموقع</h4>
                      <p className="text-xs text-text-muted leading-relaxed">
                        قم بنسخ المعرّف الرقمي المكون من أرقام فقط (مثال: <code className="font-mono text-accent">876543210</code>) وضعه في خانة <b>Chat ID</b> بالبطاقة أدناه، ثم علم على خيار "تفعيل" واضغط على حفظ الإعدادات!
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="بيانات الربط والتحكم بالتنبيهات">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input 
                      label="معرف الدردشة تيليجرام (Chat ID)" 
                      placeholder="أدخل الأرقام هنا (مثال: 987654321)" 
                      value={telegramConfig.chat_id} 
                      onChange={(e: any) => setTelegramConfig({...telegramConfig, chat_id: e.target.value})} 
                    />
                    <div className="flex flex-col justify-end pb-1">
                      <label className="flex items-center gap-3 cursor-pointer py-3">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded border-border accent-accent" 
                          checked={telegramConfig.is_enabled} 
                          onChange={(e) => setTelegramConfig({...telegramConfig, is_enabled: e.target.checked})} 
                        />
                        <span className="text-sm font-semibold">تفعيل البوت والربط المباشر</span>
                      </label>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border space-y-3">
                    <h4 className="text-sm font-bold text-text-secondary">تخصيص الإشعارات المباشرة (تنبيهات لحظية)</h4>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-border accent-accent" 
                        checked={telegramConfig.notify_invoices} 
                        onChange={(e) => setTelegramConfig({...telegramConfig, notify_invoices: e.target.checked})} 
                      />
                      <span className="text-sm">إرسال تفاصيل الفواتير والتحصيلات فور إصدارها</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-border accent-accent" 
                        checked={telegramConfig.notify_cash_transactions} 
                        onChange={(e) => setTelegramConfig({...telegramConfig, notify_cash_transactions: e.target.checked})} 
                      />
                      <span className="text-sm">إشعار فوري بحركات النقدية الكبيرة وسندات الصرف والعهود المالية</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-border accent-accent" 
                        checked={telegramConfig.notify_user_logins} 
                        onChange={(e) => setTelegramConfig({...telegramConfig, notify_user_logins: e.target.checked})} 
                      />
                      <span className="text-sm">تنبيهات أمنية فائرة عند تسجيل دخول الموظفين للرقابة التامة</span>
                    </label>
                  </div>

                  <div className="pt-4 border-t border-border space-y-3">
                    <h4 className="text-sm font-bold text-text-secondary">نظام الموافقات والاعتمادات المالية عبر الجوال (Telegram Approvals)</h4>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-border accent-accent" 
                        checked={telegramConfig.approvals_enabled} 
                        onChange={(e) => setTelegramConfig({...telegramConfig, approvals_enabled: e.target.checked})} 
                      />
                      <span className="text-sm font-semibold text-accent">تمكين اعتماد الأوامر والقيود اليومية عبر تيليجرام</span>
                    </label>
                    
                    {telegramConfig.approvals_enabled && (
                      <div className="pl-4 pr-4 py-3 rounded-lg bg-bg-secondary border border-border max-w-md">
                        <Input 
                          label="فرض الموافقات فقط للمبالغ التي تتجاوز (ريال):" 
                          type="number" 
                          placeholder="5000" 
                          value={telegramConfig.approval_threshold} 
                          onChange={(e: any) => setTelegramConfig({...telegramConfig, approval_threshold: e.target.value})} 
                        />
                        <p className="text-[10px] text-text-muted mt-1 leading-relaxed">
                          أي مستند (سند صرف، عهدة، قيد مالي) يتخطى هذا المبلغ، سيتطلب نقرة موافقة تفاعلية من هاتف المدير قبل ترحيله للدفاتر المحاسبية.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-border">
                    <Button 
                      onClick={handleSaveTelegram} 
                      disabled={telegramLoading} 
                      leftIcon={<Save size={16} />}
                    >
                      {telegramLoading ? 'جاري الحفظ...' : 'حفظ إعدادات تيليجرام'}
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Real-time Interactive Test Connection Card */}
              <Card title="فحص الاتصال والربط التفاعلي اللحظي 🧪">
                <div className="space-y-4">
                  <p className="text-xs text-text-muted leading-relaxed">
                    اضغط على زر الفحص أدناه. سيقوم الموقع بإرسال رسالة تفاعلية ذكية فوراً إلى هاتفك تحتوي على خيار القبول والرفض. 
                    اضغط عليها وسينعكس اختيارك وتحديثه أمامك على شاشة الموقع فورياً لتتأكد من نجاح الربط بنسبة 100%.
                  </p>

                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <Button 
                      onClick={handleStartTest} 
                      disabled={testLoading || testStatus === 'pending'} 
                      leftIcon={<Send size={16} />} 
                      className="btn-secondary"
                    >
                      {testLoading ? 'جاري التحميل...' : 'إطلاق الفحص التفاعلي اللحظي 🚀'}
                    </Button>

                    {testStatus === 'pending' && (
                      <div className="flex items-center gap-2 text-sm text-accent font-semibold animate-pulse">
                        <RefreshCw size={16} className="animate-spin" />
                        <span>انتظار النقر على جوالك في تيليجرام... (60 ثانية)</span>
                      </div>
                    )}

                    {testStatus === 'accepted' && (
                      <div className="p-2.5 rounded-lg bg-success/10 border border-success/30 text-success text-xs font-bold">
                        تم تأكيد فحص الربط التفاعلي بنجاح! الحالة: مقبول وموافق عليه من هاتف المدير ✅
                      </div>
                    )}

                    {testStatus === 'rejected' && (
                      <div className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
                        تم تأكيد فحص الربط التفاعلي بنجاح! الحالة: تم الرفض والمرفوض من هاتف المدير ❌
                      </div>
                    )}

                    {testStatus === 'expired' && (
                      <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs font-bold">
                        انتهت مهلة الفحص المتاحة (60 ثانية) دون الضغط على الزر. يرجى المحاولة مجدداً.
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="toast toast-success">
          <span>{toast}</span>
          <button onClick={() => setToast('')} className="btn-ghost btn-sm">✕</button>
        </div>
      )}
    </div>
  );
}
