'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatCurrency } from '@/lib/utils';

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/clients');
        const json = await res.json();
        if (json.success) {
          setClients(json.data?.clients || []);
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

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'phone', label: 'الجوال' },
    { key: 'balance', label: 'الرصيد', sortable: true, render: (row: any) => formatCurrency(row.balance) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="العملاء" description="إدارة بيانات العملاء وأرصدتهم"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عميل</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="العملاء" description="إدارة بيانات العملاء وأرصدتهم"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عميل</Button>}
      />
      {clients.length === 0 ? (
        <EmptyState title="لا توجد عملاء" actionLabel="إضافة عميل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={clients} searchable searchKeys={['name', 'phone']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة عميل" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" />
          <Input label="الجوال" /><Input label="البريد الإلكتروني" type="email" />
          <Input label="الرقم الضريبي" /><Input label="الحد الائتماني" type="number" />
          <Input label="العنوان" className="col-span-2" />
        </div>
      </Modal>
    </div>
  );
}
