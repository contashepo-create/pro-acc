'use client';

import { useState } from 'react';
import { Plus, Search, FolderTree } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';

const mockAccounts = [
  { id: '1', code: '1000', name: 'الأصول', type: 'asset', children: [
    { id: '2', code: '1110', name: 'النقدية', type: 'asset', children: [] },
    { id: '3', code: '1120', name: 'البنوك', type: 'asset', children: [] },
  ]},
  { id: '4', code: '2000', name: 'الخصوم', type: 'liability', children: [
    { id: '5', code: '2110', name: 'الدائنون', type: 'liability', children: [] },
  ]},
];

export default function AccountsPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const flattenAccounts = (accounts: any[], depth = 0): any[] => {
    const result: any[] = [];
    for (const acc of accounts) {
      result.push({ ...acc, depth, parent_name: acc.parent_name || '' });
      if (acc.children) result.push(...flattenAccounts(acc.children, depth + 1));
    }
    return result;
  };

  const flatData = flattenAccounts(mockAccounts);

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

      {flatData.length === 0 ? (
        <EmptyState title="لا توجد حسابات" description="أضف حساباً جديداً لبدء دليل الحسابات" actionLabel="إضافة حساب" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={flatData} searchable searchKeys={['name', 'code']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة حساب جديد" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
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
