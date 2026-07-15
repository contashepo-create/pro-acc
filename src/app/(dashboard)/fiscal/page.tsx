'use client';

import { useState, useEffect } from 'react';
import { Plus, Lock, Unlock } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate } from '@/lib/utils';

export default function FiscalPage() {
  const [fiscalYears, setFiscalYears] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({"name": "", "start_date": "", "end_date": ""});

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/fiscal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({});
        // Refresh data
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ: ' + JSON.stringify(json));
      }
    } catch (e) {
      setSaveError('خطأ في الاتصال بالخادم: ' + ('خطأ'));
    } finally {
      setSaving(false);
    }
  };





  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/fiscal');
        const json = await res.json();
        if (json.success) {
          setFiscalYears(json.data?.fiscalYears || []);
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
    { key: 'start_date', label: 'تاريخ البداية', render: (row: any) => formatDate(row.start_date) },
    { key: 'end_date', label: 'تاريخ النهاية', render: (row: any) => formatDate(row.end_date) },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant={row.status === 'open' ? 'success' : 'warning'}>{row.status === 'open' ? 'مفتوحة' : 'مقفلة'}</Badge> },
    { key: 'closed_at', label: 'تاريخ الإقفال', render: (row: any) => row.closed_at ? formatDate(row.closed_at) : '-' },
    {
      key: 'actions', label: '', render: (row: any) => (
        <div className="flex gap-1">
          {row.status === 'open' ? (
            <Button variant="ghost" size="sm"><Lock size={14} /></Button>
          ) : (
            <Button variant="ghost" size="sm"><Unlock size={14} /></Button>
          )}
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="السنوات المالية" description="إدارة الفترات المالية وإقفال السنة"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة سنة مالية</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="السنوات المالية" description="إدارة الفترات المالية وإقفال السنة"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة سنة مالية</Button>}
      />
      {fiscalYears.length === 0 ? (
        <EmptyState title="لا توجد سنوات مالية" actionLabel="إضافة سنة مالية" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={fiscalYears} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة سنة مالية" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" placeholder="مثال: 2026" className="col-span-2" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
          <Input label="تاريخ البداية" type="date" value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} />
          <Input label="تاريخ النهاية" type="date" value={form.end_date} onChange={(e) => setForm({...form, end_date: e.target.value})} />
                  {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
