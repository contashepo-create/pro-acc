'use client';

import { useState, useEffect } from 'react';
import { Plus, Users, AlertTriangle, Crown, MapPin, Phone, Calendar, Shield } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const [maxUsers, setMaxUsers] = useState<number | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [form, setForm] = useState<any>({
    name: '',
    email: '',
    password: '',
    role: 'accountant',
    phone: '',
    birth_date: '',
    city: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/company/users');
      const json = await res.json();
      if (json.success) {
        setUsers(json.data?.users || []);
        setCurrentCount(json.data?.currentCount || 0);
        setMaxUsers(json.data?.maxUsers ?? null);
        setPlanName(json.data?.planName || null);
      } else {
        setError(json.message || 'فشل');
      }
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const canAddUser = (): boolean => {
    if (maxUsers === null) return true; // لا يوجد حد
    return currentCount < maxUsers;
  };

  const getUserLimitPercentage = (): number => {
    if (maxUsers === null || maxUsers === 0) return 0;
    return Math.min(100, Math.round((currentCount / maxUsers) * 100));
  };

  const getUserLimitColor = (): string => {
    const pct = getUserLimitPercentage();
    if (pct >= 100) return 'bg-red-500';
    if (pct >= 80) return 'bg-orange-500';
    if (pct >= 60) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const handleSave = async () => {
    if (!form.name || !form.email || (!editingUser && !form.password)) {
      setSaveError('الاسم والبريد الإلكتروني وكلمة المرور مطلوبة');
      return;
    }
    if (!editingUser && form.password && form.password.length < 6) {
      setSaveError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    setSaving(true);
    setSaveError('');

    try {
      const url = editingUser ? `/api/company/users/${editingUser.id}` : '/api/company/users';
      const method = editingUser ? 'PUT' : 'POST';

      const payload: any = {
        name: form.name,
        email: form.email,
        role: form.role,
        phone: form.phone || undefined,
        birth_date: form.birth_date || undefined,
        city: form.city || undefined,
      };

      if (!editingUser) {
        payload.password = form.password;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingUser(null);
        setForm({ name: '', email: '', password: '', role: 'accountant', phone: '', birth_date: '', city: '' });
        fetchData();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch {
      setSaveError('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (user: any) => {
    try {
      const res = await fetch(`/api/company/users/${user.id}`);
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        setEditingUser(user);
        setForm({
          name: d.name || '',
          email: d.email || '',
          password: '',
          role: d.role || 'accountant',
          phone: d.phone || '',
          birth_date: d.birth_date || '',
          city: d.city || '',
        });
        setShowModal(true);
      }
    } catch {
      console.error('Failed to load user');
    }
  };

  const handleDelete = async (user: any) => {
    try {
      const res = await fetch(`/api/company/users/${user.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const openAddModal = () => {
    if (!canAddUser()) {
      alert(`❌ تم الوصول للحد الأقصى للمستخدمين (${maxUsers}) في باقة "${planName || 'الحالية'}".\nيرجى ترقية الباقة لإضافة مزيد من المستخدمين.`);
      return;
    }
    setEditingUser(null);
    setForm({ name: '', email: '', password: '', role: 'accountant', phone: '', birth_date: '', city: '' });
    setShowModal(true);
  };

  const roleBadge = (role: string) => {
    const map: Record<string, { color: string; label: string }> = {
      admin: { color: 'bg-red-100 text-red-700 border-red-200', label: 'مدير النظام' },
      manager: { color: 'bg-blue-100 text-blue-700 border-blue-200', label: 'مدير' },
      accountant: { color: 'bg-green-100 text-green-700 border-green-200', label: 'محاسب' },
      supervisor: { color: 'bg-gray-100 text-gray-700 border-gray-200', label: 'مشرف' },
    };
    const m = map[role] || { color: 'bg-gray-100 text-gray-700', label: role };
    return <Badge className={`${m.color} border`}>{m.label}</Badge>;
  };

  const columns = [
    {
      key: 'name',
      label: 'المستخدم',
      sortable: true,
      render: (row: any) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
            {row.name?.charAt(0) || '?'}
          </div>
          <div>
            <div className="font-medium">{row.name}</div>
            <div className="text-xs text-gray-500">{row.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'الجوال',
      render: (row: any) => row.phone ? (
        <span className="flex items-center gap-1 text-sm" dir="ltr">
          <Phone size={12} /> {row.phone}
        </span>
      ) : <span className="text-gray-400 text-sm">—</span>,
    },
    {
      key: 'city',
      label: 'المدينة',
      render: (row: any) => row.city ? (
        <span className="flex items-center gap-1 text-sm">
          <MapPin size={12} /> {row.city}
        </span>
      ) : <span className="text-gray-400 text-sm">—</span>,
    },
    {
      key: 'role',
      label: 'الدور',
      render: (row: any) => roleBadge(row.role),
    },
    {
      key: 'is_active',
      label: 'الحالة',
      render: (row: any) => (
        <Badge variant={row.is_active ? 'success' : 'danger'}>
          {row.is_active ? 'نشط' : 'غير نشط'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <ActionButtons item={row} onEdit={handleEdit} onDelete={handleDelete} />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader 
        title="المستخدمين" 
        description="إدارة المستخدمين والصلاحيات في شركتك"
        actions={<Button onClick={openAddModal} leftIcon={<Plus size={18} />}>إضافة مستخدم</Button>}
      />

      {/* ========== بطاقة حد المستخدمين ========== */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Users size={20} className="text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">حد المستخدمين</h3>
              <p className="text-sm text-gray-500">
                {planName ? `باقة "${planName}"` : 'الباقة الحالية'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800">{currentCount}</div>
              <div className="text-xs text-gray-500">مستخدم حالي</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800">{maxUsers ?? '∞'}</div>
              <div className="text-xs text-gray-500">الحد الأقصى</div>
            </div>
            <div className="w-40">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{getUserLimitPercentage()}%</span>
                {maxUsers && currentCount >= maxUsers && (
                  <span className="text-red-500 font-medium">مكتمل</span>
                )}
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${getUserLimitColor()}`}
                     style={{ width: `${getUserLimitPercentage()}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* تحذير عند الاقتراب من الحد */}
        {maxUsers && currentCount >= maxUsers && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-red-700 text-sm">
            <AlertTriangle size={18} />
            <span>
              <strong>تم الوصول للحد الأقصى!</strong> لا يمكن إضافة مستخدمين جدد. يرجى ترقية الباقة من صفحة الاشتراك.
            </span>
          </div>
        )}
        {maxUsers && currentCount >= maxUsers! * 0.8 && currentCount < maxUsers && (
          <div className="mt-4 bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center gap-2 text-orange-700 text-sm">
            <AlertTriangle size={18} />
            <span>
              <strong>تنبيه:</strong> اقتربت من الوصول للحد الأقصى ({currentCount}/{maxUsers}). 
            </span>
          </div>
        )}
      </Card>

      {/* ========== جدول المستخدمين ========== */}
      {users.length === 0 ? (
        <EmptyState 
          title="لا يوجد مستخدمين" 
          description="أضف أول مستخدم في شركتك"
          actionLabel="إضافة مستخدم" 
          onAction={openAddModal} 
        />
      ) : (
        <DataTable columns={columns} data={users} searchable searchKeys={['name', 'email', 'phone', 'city']} />
      )}

      {/* ========== نافذة الإضافة/التعديل ========== */}
      <Modal 
        isOpen={showModal} 
        onClose={() => { setShowModal(false); setEditingUser(null); }} 
        title={editingUser ? `تعديل: ${editingUser.name}` : '➕ إضافة مستخدم جديد'} 
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingUser(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* معلومات الحساب */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700 flex items-center gap-2">
            <Shield size={16} />
            <span>المستخدم الجديد سيكون مرتبطاً بشركتك فقط ولن يتمكن من الوصول لأي شركة أخرى</span>
          </div>

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {saveError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input 
              label="الاسم الكامل *" 
              value={form.name} 
              onChange={(e) => setForm({...form, name: e.target.value})} 
              placeholder="مثال: أحمد محمد"
            />
            <Input 
              label="البريد الإلكتروني *" 
              type="email" 
              value={form.email} 
              onChange={(e) => setForm({...form, email: e.target.value})} 
              placeholder="example@company.com"
              dir="ltr"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input 
              label={editingUser ? 'كلمة المرور الجديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور *'} 
              type="password" 
              value={form.password} 
              onChange={(e) => setForm({...form, password: e.target.value})} 
              placeholder="6 أحرف على الأقل"
              dir="ltr"
            />
            <Select 
              label="الدور *" 
              value={form.role} 
              onChange={(v) => setForm({...form, role: v})} 
              options={[
                { value: 'admin', label: '🔴 مدير النظام - صلاحية كاملة' },
                { value: 'manager', label: '🔵 مدير - كل شيء ما عدا الإعدادات الحساسة' },
                { value: 'accountant', label: '🟢 محاسب - إنشاء وتعديل (بدون حذف)' },
                { value: 'supervisor', label: '⚪ مشرف - قراءة فقط' },
              ]} 
            />
          </div>

          <div className="border-t pt-4 mt-4">
            <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
              <span>📋</span> معلومات إضافية (اختياري)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input 
                label="رقم الجوال" 
                value={form.phone} 
                onChange={(e) => setForm({...form, phone: e.target.value})} 
                placeholder="+966 5XX XXX XXXX"
                dir="ltr"
              />
              <Input 
                label="المدينة" 
                value={form.city} 
                onChange={(e) => setForm({...form, city: e.target.value})} 
                placeholder="مثال: الرياض"
              />
              <Input 
                label="تاريخ الميلاد" 
                type="date" 
                value={form.birth_date} 
                onChange={(e) => setForm({...form, birth_date: e.target.value})} 
              />
            </div>
          </div>

          {/* معلومات الحد */}
          {maxUsers && (
            <div className="bg-gray-50 border rounded-lg p-3 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Crown size={14} className="text-yellow-500" />
                <span>
                  المتاح: <strong>{maxUsers - currentCount}</strong> مستخدم من أصل <strong>{maxUsers}</strong> 
                  {planName && <> في باقة "{planName}"</>}
                </span>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
