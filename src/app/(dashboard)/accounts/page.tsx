'use client';

import { useState, useEffect } from 'react';
import { Plus, FolderTree } from 'lucide-react';
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/accounts');
        const json = await res.json();
        if (json.success) {
          setAccounts(json.data?.accounts || []);
        } else {
          setError(json.message || 'فشل تحميل البيانات');
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

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

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="دليل الحسابات" description="إدارة شجرة الحسابات المحاسبية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة حساب</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

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

      {flatData.length === 0 ? (
        <EmptyState title="لا توجد حسابات" description="أضف حساباً جديداً لبدء دليل الحسابات" actionLabel="إضافة حساب" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={flatData} searchable searchKeys={['name', 'code']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة حساب جديد" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="رمز الحساب" placeholder="مثال: 1130" />
          <Select label="النوع" options={[
            { value: 'asset', label: 'أصل' }, { value: 'liability', label: 'خصم' },
            { value: 'equity', label: 'حق ملكية' }, { value: 'revenue', label: 'إيراد' },
            { value: 'expense', label: 'مصروف' },
          ]} />
          <Input label="اسم الحساب" placeholder="اسم الحساب بالعربية" className="col-span-2" />
          <Select label="الحساب الأب" options={[{ value: '', label: 'بدون' }]} className="col-span-2" />
        </div>
      </Modal>
    </div>
  );
}
