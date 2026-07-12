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

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Form state
  const [form, setForm] = useState({ code: '', name: '', nameEn: '', type: 'asset', parentId: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/accounts');
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

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.code || !form.name) {
      setSaveError('رمز واسم الحساب مطلوبان');
      return;
    }
    if (!/^\d{4}$/.test(form.code)) {
      setSaveError('رمز الحساب يجب أن يكون 4 أرقام');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
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
    { key: 'code', label: 'الرمز', sortable: true },
    { key: 'name', label: 'اسم الحساب', sortable: true,
      render: (row: any) => (
        <span style={{ paddingRight: `${(row.depth || 0) * 20}px` }} className="flex items-center gap-2">
          {row.depth > 0 && <FolderTree size={14} className="text-text-muted" />}
          {row.name}
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
        description="إدارة شجرة الحسابات المحاسبية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة حساب
          </Button>
        }
      />

      {error && <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>}

      {flatData.length === 0 ? (
        <EmptyState title="لا توجد حسابات" description="أضف حساباً جديداً لبدء دليل الحسابات" actionLabel="إضافة حساب" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={flatData} searchable searchKeys={['name', 'code']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة حساب جديد" size="lg"
        footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving} leftIcon={<Save size={16} />}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="رمز الحساب (4 أرقام)" placeholder="مثال: 1130" value={form.code} onChange={(e:any)=>setForm({...form, code: e.target.value})} />
          <Select label="النوع" value={form.type} onChange={(e:any)=>setForm({...form, type: e.target.value})} options={[
            { value: 'asset', label: 'أصل' }, { value: 'liability', label: 'خصم' },
            { value: 'equity', label: 'حق ملكية' }, { value: 'revenue', label: 'إيراد' },
            { value: 'expense', label: 'مصروف' },
          ]} />
          <Input label="اسم الحساب" placeholder="اسم الحساب بالعربية" className="col-span-2" value={form.name} onChange={(e:any)=>setForm({...form, name: e.target.value})} />
          <Input label="الاسم الإنجليزي (اختياري)" placeholder="Account name in English" className="col-span-2" value={form.nameEn} onChange={(e:any)=>setForm({...form, nameEn: e.target.value})} />
          <Select label="الحساب الأب" value={form.parentId} onChange={(e:any)=>setForm({...form, parentId: e.target.value})} options={[{ value: '', label: 'بدون - حساب رئيسي' }, ...flatData.map((a:any)=>({ value: a.id, label: `${a.code} - ${a.name}` }))]} className="col-span-2" />
          {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
