'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Card, Button, Input, Select, Modal, Badge, StatCard, EmptyState, DataTable, Toast } from '@/components/ui';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

interface CompanyUsersResponse {
  users: User[];
  currentCount: number;
  maxUsers: number | null;
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'مدير النظام' },
  { value: 'manager', label: 'مدير' },
  { value: 'accountant', label: 'محاسب' },
  { value: 'supervisor', label: 'مشرف' },
];

const ROLE_COLORS: Record<string, string> = {
  admin: 'danger',
  manager: 'warning',
  accountant: 'accent',
  supervisor: 'info',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'مدير النظام',
  manager: 'مدير',
  accountant: 'محاسب',
  supervisor: 'مشرف',
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentCount, setCurrentCount] = useState(0);
  const [maxUsers, setMaxUsers] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'accountant' });
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', role: '', is_active: true });

  const fetchUsers = useCallback(async () => {
    try {
      const token = document.cookie.replace(/(?:(?:^|.*;\s*)token\s*=\s*([^;]*).*$)|^.*$/, '$1');
      const res = await fetch('/api/company/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        const result = data.data as any as CompanyUsersResponse;
        setUsers(result.users);
        setCurrentCount(result.currentCount);
        setMaxUsers(result.maxUsers);
      } else {
        setToast({ message: data.message || 'خطأ في تحميل البيانات', type: 'error' });
      }
    } catch {
      setToast({ message: 'خطأ في الاتصال', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleAdd = async () => {
    if (!form.name || !form.email || !form.password) {
      setToast({ message: 'جميع الحقول مطلوبة', type: 'error' });
      return;
    }
    if (form.password.length < 8) {
      setToast({ message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل', type: 'error' });
      return;
    }
    try {
      const token = document.cookie.replace(/(?:(?:^|.*;\s*)token\s*=\s*([^;]*).*$)|^.*$/, '$1');
      const res = await fetch('/api/company/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ message: 'تم إضافة المستخدم بنجاح', type: 'success' });
        setShowModal(false);
        setForm({ name: '', email: '', password: '', role: 'accountant' });
        fetchUsers();
      } else {
        setToast({ message: data.message || 'خطأ في الإضافة', type: 'error' });
      }
    } catch {
      setToast({ message: 'خطأ في الاتصال', type: 'error' });
    }
  };

  const handleUpdate = async () => {
    if (!editUser) return;
    try {
      const token = document.cookie.replace(/(?:(?:^|.*;\s*)token\s*=\s*([^;]*).*$)|^.*$/, '$1');
      const body: Record<string, any> = {};
      if (editForm.name) body.name = editForm.name;
      if (editForm.email) body.email = editForm.email;
      if (editForm.password) body.password = editForm.password;
      if (editForm.role) body.role = editForm.role;
      body.is_active = editForm.is_active;

      const res = await fetch(`/api/company/users/${editUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ message: 'تم تحديث المستخدم', type: 'success' });
        setEditUser(null);
        fetchUsers();
      } else {
        setToast({ message: data.message || 'خطأ في التحديث', type: 'error' });
      }
    } catch {
      setToast({ message: 'خطأ في الاتصال', type: 'error' });
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`هل أنت متأكد من حذف المستخدم "${user.name}"؟`)) return;
    setDeleting(user.id);
    try {
      const token = document.cookie.replace(/(?:(?:^|.*;\s*)token\s*=\s*([^;]*).*$)|^.*$/, '$1');
      const res = await fetch(`/api/company/users/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setToast({ message: 'تم حذف المستخدم', type: 'success' });
        fetchUsers();
      } else {
        setToast({ message: data.message || 'خطأ في الحذف', type: 'error' });
      }
    } catch {
      setToast({ message: 'خطأ في الاتصال', type: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="إدارة المستخدمين" description="إضافة وإدارة أعضاء فريق العمل" />
        <div className="animate-pulse space-y-4 mt-6">
          <div className="h-24 bg-bg-secondary rounded-xl" />
          <div className="h-64 bg-bg-secondary rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="إدارة المستخدمين" description="إضافة وإدارة أعضاء فريق العمل" />

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="المستخدمين الحاليين" value={String(currentCount)} icon="Users" />
        <StatCard title="الحد الأقصى" value={maxUsers ? String(maxUsers) : 'غير محدود'} icon="Shield" />
        <StatCard
          title="المتبقي"
          value={maxUsers ? String(Math.max(0, maxUsers - currentCount)) : '∞'}
          icon="UserPlus"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-text-muted">
          {maxUsers && currentCount >= maxUsers
            ? '⚠️ تم الوصول للحد الأقصى. يرجى ترقية الباقة.'
            : `${currentCount} من ${maxUsers || '∞'} مستخدم`}
        </p>
        <Button
          onClick={() => setShowModal(true)}
          disabled={!!(maxUsers && currentCount >= maxUsers)}
        >
          إضافة مستخدم
        </Button>
      </div>

      {/* Users Table */}
      {users.length === 0 ? (
        <EmptyState title="لا يوجد مستخدمين" description="أضف أول عضو في فريقك" />
      ) : (
        <Card>
          <DataTable
            columns={[
              { key: 'name', label: 'الاسم', render: (row) => (
                <div>
                  <p className="font-medium">{(row as any as User).name}</p>
                  <p className="text-xs text-text-muted">{(row as any as User).email}</p>
                </div>
              )},
              { key: 'role', label: 'الدور', render: (row) => (
                <Badge variant={(ROLE_COLORS[(row as any as User).role] || 'info') as "info"}>
                  {ROLE_LABELS[(row as any as User).role] || (row as any as User).role}
                </Badge>
              )},
              { key: 'is_active', label: 'الحالة', render: (row) => (
                <Badge variant={(row as any as User).is_active ? 'success' : 'danger'}>
                  {(row as any as User).is_active ? 'نشط' : 'مُعطّل'}
                </Badge>
              )},
              { key: 'last_login', label: 'آخر دخول', render: (row) => (
                <span className="text-sm text-text-muted">
                  {(row as any as User).last_login
                    ? new Date((row as any as User).last_login!).toLocaleDateString('ar-SA')
                    : 'لم يدخل بعد'}
                </span>
              )},
              { key: 'actions', label: 'إجراءات', render: (row) => (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const u = row as User;
                      setEditUser(u);
                      setEditForm({ name: u.name, email: u.email, password: '', role: u.role, is_active: u.is_active });
                    }}
                  >
                    تعديل
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() => handleDelete(row as any as User)}
                    disabled={deleting === (row as any as User).id}
                  >
                    {deleting === (row as any as User).id ? '...' : 'حذف'}
                  </Button>
                </div>
              )},
            ]}
            data={users}
          />
        </Card>
      )}

      {/* Add User Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة مستخدم جديد">
        <div className="space-y-4">
          <Input label="الاسم الكامل" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="محمد أحمد" />
          <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@company.com" />
          <Input label="كلمة المرور" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8 أحرف على الأقل" />
          <Select label="الدور" value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={ROLE_OPTIONS} />
          <div className="flex gap-3 pt-4">
            <Button onClick={handleAdd} className="flex-1">إضافة</Button>
            <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          </div>
        </div>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title={`تعديل: ${editUser?.name || ''}`}>
        <div className="space-y-4">
          <Input label="الاسم" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <Input label="البريد الإلكتروني" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
          <Input label="كلمة مرور جديدة (اختياري)" type="password" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} placeholder="اتركه فارغاً للإبقاء على الحالية" />
          <Select label="الدور" value={editForm.role} onChange={(v) => setEditForm({ ...editForm, role: v })} options={ROLE_OPTIONS} />
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} id="active" />
            <label htmlFor="active" className="text-sm">حساب نشط</label>
          </div>
          <div className="flex gap-3 pt-4">
            <Button onClick={handleUpdate} className="flex-1">حفظ</Button>
            <Button variant="ghost" onClick={() => setEditUser(null)}>إلغاء</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
