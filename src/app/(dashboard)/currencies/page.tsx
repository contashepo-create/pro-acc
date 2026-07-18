'use client';

import { useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';

export default function CurrenciesPage() {
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/currencies');
        const json = await res.json();
        if (json.success) {
          setCurrencies(json.data || []);
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
    { key: 'code', label: 'الكود', sortable: true },
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'rate', label: 'سعر الصرف', sortable: true,
      render: (row: any) => row.rate.toFixed(4),
    },
    { key: 'is_base', label: 'الأساسية',
      render: (row: any) => row.is_base ? <Badge variant="accent">الأساسية</Badge> : '',
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="العملات" description="إدارة العملات وأسعار الصرف"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عملة</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="العملات"
        description="إدارة العملات وأسعار الصرف"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عملة</Button>
        }
      />
      {currencies.length === 0 ? (
        <EmptyState title="لا توجد عملات" actionLabel="إضافة عملة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={currencies} searchable searchKeys={['code', 'name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة عملة" size="sm" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button>حفظ</Button></div>}>
        <div className="space-y-4">
          <Input label="كود العملة" placeholder="مثال: USD" />
          <Input label="اسم العملة" placeholder="مثال: دولار أمريكي" />
          <Input label="سعر الصرف" type="number" placeholder="مقابل العملة الأساسية" />
        </div>
      </Modal>
    </div>
  );
}
