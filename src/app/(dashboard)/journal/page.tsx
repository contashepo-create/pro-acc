'use client';

import { useState, useEffect } from 'react';
import { Plus, Eye } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';

export default function JournalPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const handleSave = async () => {
    // TODO: Implement save logic for this page
    // This is a temporary fix to prevent empty button
    alert('جاري تطوير حفظ البيانات لهذا القسم - سيتم تفعيله قريباً');
    setShowModal(false);
  };


  const [showDetail, setShowDetail] = useState<any>(null);
  const [lines, setLines] = useState([{ account_id: '', debit: 0, credit: 0, description: '' }]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/journal');
        const json = await res.json();
        if (json.success) {
          setEntries(json.data?.entries || []);
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
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true,
      render: (row: any) => formatDate(row.date),
    },
    { key: 'description', label: 'البيان', sortable: true },
    { key: 'type', label: 'النوع', sortable: true,
      render: (row: any) => <Badge variant={row.type === 'closing' ? 'warning' : 'info'}>{row.type}</Badge>,
    },
    {
      key: 'actions', label: '', render: (row: any) => (
        <Button variant="ghost" size="sm" onClick={() => setShowDetail(row)}><Eye size={16} /></Button>
      ),
    },
  ];

  const addLine = () => setLines([...lines, { account_id: '', debit: 0, credit: 0, description: '' }]);

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="القيود المحاسبية" description="إدخال وعرض القيود اليومية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة قيد</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="القيود المحاسبية"
        description="إدخال وعرض القيود اليومية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة قيد
          </Button>
        }
      />

      {entries.length === 0 ? (
        <EmptyState title="لا توجد قيود" description="أضف قيداً محاسبياً جديداً" actionLabel="إضافة قيد" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={entries} searchable searchKeys={['description', 'number']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة قيد محاسبي" size="xl" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave}>حفظ</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" />
            <Select label="النوع" options={[
              { value: 'general', label: 'عام' },
              { value: 'opening_balance', label: 'افتتاحي' },
              { value: 'accrual', label: 'استحقاق' },
            ]} />
          </div>
          <Textarea label="البيان" placeholder="شرح القيد" />
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="p-2 text-right">الحساب</th>
                  <th className="p-2 text-right">مدين</th>
                  <th className="p-2 text-right">دائن</th>
                  <th className="p-2 text-right">البيان</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2"><Select options={[{ value: '', label: 'اختر حساباً' }]} /></td>
                    <td className="p-2"><Input type="number" /></td>
                    <td className="p-2"><Input type="number" /></td>
                    <td className="p-2"><Input placeholder="شرح" /></td>
                    <td className="p-2">
                      {lines.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                          ✕
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="secondary" size="sm" onClick={addLine}>إضافة سطر</Button>
        </div>
      </Modal>

      <Modal isOpen={!!showDetail} onClose={() => setShowDetail(null)} title={`قيد رقم #${showDetail?.number || ''}`} size="lg">
        {showDetail && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div><span className="text-text-muted">التاريخ:</span> {formatDate(showDetail.date)}</div>
              <div><span className="text-text-muted">النوع:</span> {showDetail.type}</div>
              <div className="col-span-2"><span className="text-text-muted">البيان:</span> {showDetail.description}</div>
            </div>
            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary">
                  <tr><th className="p-2 text-right">الحساب</th><th className="p-2 text-right">مدين</th><th className="p-2 text-right">دائن</th></tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border"><td className="p-2 text-text-muted" colSpan={3}>لا توجد بنود</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
