'use client';

import { useState, useEffect } from 'react';
import { Plus, FolderTree, Save } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { apiFetch } from '@/lib/api-client';

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Form state
  const [form, setForm] = useState({ code: '', name: '', nameEn: '', type: 'asset', parentId: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiFetch('/api/accounts');
      const json = await res.json();
      if (json.success) {
        setAccounts(json.data?.accounts || []);
      } else {
        setError(json.message || 'فشل تحميل البيانات');
      }
    } catch {
      setError('فشل تحميل البيانات - خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, []);

  const handleOpenAdd = () => {
    setEditingAccount(null);
    setForm({ code: '', name: '', nameEn: '', type: 'asset', parentId: '' });
    setSaveError('');
    setShowModal(true);
  };

  const handleOpenEdit = (account: any) => {
    setEditingAccount(account);
    setForm({
      code: account.code || '',
      name: account.name || '',
      nameEn: account.name_en || '',
      type: account.type || 'asset',
      parentId: account.parent_id || '',
    });
    setSaveError('');
    setShowModal(true);
  };

  const handleDelete = async (account: any) => {
    try {
      const res = await apiFetch(`/api/accounts/${account.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setAccounts((prev) => removeAccountFromTree(prev, account.id));
        toast.success('تم حذف الحساب');
        await fetchData();
      } else if (res.status === 404) {
        setAccounts((prev) => removeAccountFromTree(prev, account.id));
        toast.success('تم حذف الحساب مسبقاً');
        await fetchData();
      } else {
        toast.error(json.message || 'فشل الحذف');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  const handleSave = async () => {
    if (!form.code || !form.name) {
      setSaveError('رمز واسم الحساب مطلوبان');
      return;
    }
    if (!/^\d{4}(?:-\d{1,6})?$/.test(form.code.trim())) {
      setSaveError('رمز الحساب: 4 أرقام للحساب الأب، أو الأب ثم التسلسل مثل 1110-0001');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const isEditing = !!editingAccount;
      const url = isEditing ? `/api/accounts/${editingAccount.id}` : '/api/accounts';
      const method = isEditing ? 'PUT' : 'POST';
      
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          nameEn: form.nameEn,
          type: form.type,
          parentId: form.parentId || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({ code: '', name: '', nameEn: '', type: 'asset', parentId: '' });
        setEditingAccount(null);
        fetchData();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch {
      setSaveError('فشل الحفظ - خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const removeAccountFromTree = (accs: any[], id: string): any[] =>
    accs
      .filter((a) => a.id !== id)
      .map((a) => ({
        ...a,
        children: a.children ? removeAccountFromTree(a.children, id) : [],
      }));

  const flattenAccounts = (accs: any[], depth = 0): any[] => {
    const result: any[] = [];
    for (const acc of accs) {
      result.push({ ...acc, depth, parent_name: acc.parent_name || '' });
      if (acc.children) result.push(...flattenAccounts(acc.children, depth + 1));
    }
    return result;
  };

  const flatData = flattenAccounts(accounts);

  const columns = [
    {
      key: 'code',
      label: 'الرمز',
      sortable: true,
      render: (row: any) => (
        <span dir="ltr" className="font-mono inline-block" style={{ unicodeBidi: 'isolate' }}>
          {row.code}
        </span>
      ),
    },
    { key: 'name', label: 'اسم الحساب', sortable: true,
      render: (row: any) => (
        <span style={{ paddingRight: `${(row.depth || 0) * 20}px` }} className="flex items-center gap-2">
          {row.depth > 0 && <FolderTree size={14} className="text-text-muted" />}
          {row.name}
          {row.is_header && <Badge variant="info">رئيسي</Badge>}
        </span>
      ),
    },
    { key: 'type', label: 'النوع', sortable: true,
      render: (row: any) => <Badge variant={row.type === 'asset' || row.type === 'expense' ? 'info' : 'accent'}>{row.type}</Badge>,
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="دليل الحسابات"
        description="إدارة دليل الحسابات الموحد والمصمم وفق المعايير المحاسبية الدولية (IFRS)"
        actions={
          <Button onClick={handleOpenAdd} leftIcon={<Plus size={18} />}>
            إضافة حساب
          </Button>
        }
      />

      {error && <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>}

      {flatData.length === 0 ? (
        <EmptyState title="لا توجد حسابات" description="أضف حساباً جديداً إلى دليل الحسابات" actionLabel="إضافة حساب" onAction={handleOpenAdd} />
      ) : (
        <DataTable columns={[...columns, { 
          key: 'actions', 
          label: 'إجراءات', 
          render: (row:any) => (
            <ActionButtons
              item={row}
              onEdit={handleOpenEdit}
              onDelete={handleDelete}
            />
          )
        }]} data={flatData} searchable searchKeys={['name', 'code']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingAccount ? `تعديل حساب ${editingAccount.code}` : "إضافة حساب جديد"} size="lg"
        footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving} leftIcon={<Save size={16} />}>{saving ? 'جاري الحفظ...' : (editingAccount ? 'تحديث' : 'حفظ')}</Button></div>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="رمز الحساب" placeholder="مثال: 1130 أو 1110-0001 (الأب ثم الرقم)" value={form.code} onChange={(e:any)=>setForm({...form, code: e.target.value})} dir="ltr" />
          <Select label="النوع" value={form.type} disabled={!!editingAccount} onChange={(value)=>setForm({...form, type: value})} options={[
            { value: 'asset', label: 'أصل' }, { value: 'liability', label: 'خصم' },
            { value: 'equity', label: 'حق ملكية' }, { value: 'revenue', label: 'إيراد' },
            { value: 'expense', label: 'مصروف' },
          ]} />
          <Input label="اسم الحساب" placeholder="اسم الحساب بالعربية" className="col-span-2" value={form.name} onChange={(e:any)=>setForm({...form, name: e.target.value})} />
          <Input label="الاسم الإنجليزي (اختياري)" placeholder="Account name in English" className="col-span-2" value={form.nameEn} onChange={(e:any)=>setForm({...form, nameEn: e.target.value})} />
          <Select label="الحساب الأب" value={form.parentId} disabled={!!editingAccount} onChange={(value)=>setForm({...form, parentId: value})} options={[{ value: '', label: 'بدون - حساب رئيسي' }, ...flatData.map((a:any)=>({ value: a.id, label: `\u202A${a.code}\u202C — ${a.name}` }))]} className="col-span-2" />
          {editingAccount && (
            <p className="col-span-2 text-xs text-text-muted">لا يمكن تغيير نوع الحساب أو الحساب الأب بعد الإنشاء (حماية لسلامة القيود المحاسبية).</p>
          )}
          {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
