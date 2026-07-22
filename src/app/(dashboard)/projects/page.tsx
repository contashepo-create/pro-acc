'use client';

import { useState, useEffect } from 'react';
import { Plus, Lock } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    name: '',
    client_id: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    budget: 0,
  });
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingProject, setClosingProject] = useState<any>(null);
  const [closeForm, setCloseForm] = useState<any>({
    close_date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');

  const handleSave = async () => {
    if (!form.name) {
      setSaveError('اسم المشروع مطلوب');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const url = editingProject ? `/api/projects/${editingProject.id}` : '/api/projects';
      const method = editingProject ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingProject(null);
        setForm({
          name: '',
          client_id: '',
          start_date: new Date().toISOString().split('T')[0],
          end_date: '',
          budget: 0,
        });
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch (e: any) {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (project: any) => {
    try {
      const res = await fetch(`/api/projects/${project.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingProject(project);
        setForm({
          name: json.data.name,
          client_id: json.data.client_id || '',
          start_date: json.data.start_date,
          end_date: json.data.end_date || '',
          budget: json.data.budget || 0,
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load project:', e);
    }
  };

  const handleDelete = async (project: any) => {
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        window.location.reload();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const openCloseModal = (project: any) => {
    setClosingProject(project);
    setCloseForm({ close_date: new Date().toISOString().split('T')[0], notes: '' });
    setCloseError('');
    setShowCloseModal(true);
  };

  const handleClose = async () => {
    if (!closingProject) return;
    setClosing(true); setCloseError('');
    try {
      const res = await fetch(`/api/projects/${closingProject.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(closeForm),
      });
      const json = await res.json();
      if (json.success) {
        setShowCloseModal(false);
        setClosingProject(null);
        toast.success('تم إقفال المشروع بنجاح');
        window.location.reload();
      } else setCloseError(json.message || 'فشل الإقفال');
    } catch (e: any) { setCloseError('خطأ في الاتصال'); } finally { setClosing(false); }
  };

  const [statusTab, setStatusTab] = useState('all');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [projRes, cliRes] = await Promise.all([
          fetch('/api/projects'),
          fetch('/api/clients'),
        ]);
        const [projJson, cliJson] = await Promise.all([
          projRes.json(),
          cliRes.json(),
        ]);
        if (projJson.success) {
          setProjects(projJson.data?.projects || []);
        } else {
          setError(projJson.message || 'فشل');
        }
        if (cliJson.success) {
          setClients(cliJson.data?.clients || []);
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
      active: { variant: 'success', label: 'نشط' },
      completed: { variant: 'info', label: 'مكتمل' },
      cancelled: { variant: 'danger', label: 'ملغى' },
      on_hold: { variant: 'warning', label: 'مُعلّق' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const filtered = statusTab === 'all' ? projects : projects.filter(p => p.status === statusTab);

  const columns = [
    { key: 'name', label: 'اسم المشروع', sortable: true },
    { key: 'client_name', label: 'العميل', sortable: true },
    { key: 'start_date', label: 'تاريخ البدء', render: (row: any) => formatDate(row.start_date) },
    { key: 'end_date', label: 'تاريخ الانتهاء', render: (row: any) => row.end_date ? formatDate(row.end_date) : '-' },
    { key: 'budget', label: 'الميزانية', render: (row: any) => formatCurrency(row.budget) },
    { key: 'status', label: 'الحالة', render: (row: any) => statusBadge(row.status) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <div className="flex items-center gap-2">
          {row.status === 'active' && (
            <Button variant="ghost" size="sm" onClick={() => openCloseModal(row)} title="إقفال المشروع">
              <Lock size={16} className="text-orange-600" />
            </Button>
          )}
          <ActionButtons item={row} onEdit={handleEdit} onDelete={handleDelete} />
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="المشاريع"
        description="إدارة المشاريع"
        actions={
          <Button onClick={() => { setEditingProject(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            إضافة مشروع
          </Button>
        }
      />

      <div className="flex gap-4">
        <Button variant={statusTab === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('all')}>الكل</Button>
        <Button variant={statusTab === 'active' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('active')}>نشط</Button>
        <Button variant={statusTab === 'completed' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('completed')}>مكتمل</Button>
        <Button variant={statusTab === 'on_hold' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('on_hold')}>مُعلّق</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد مشاريع" actionLabel="إضافة مشروع" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={filtered} searchable searchKeys={['name', 'client_name']} />
      )}

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingProject(null); }}
        title={editingProject ? `تعديل مشروع: ${editingProject.name}` : 'إضافة مشروع'}
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingProject(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="اسم المشروع" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="col-span-2" />
            <Select
              label="العميل (اختياري)"
              value={form.client_id}
              onChange={(v) => setForm({...form, client_id: v})}
              options={[{ value: '', label: 'بدون عميل' }, ...clients.map((c: any) => ({ value: c.id, label: c.name }))]}
              className="col-span-2"
            />
            <Input label="تاريخ البدء" type="date" value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} />
            <Input label="تاريخ الانتهاء" type="date" value={form.end_date} onChange={(e) => setForm({...form, end_date: e.target.value})} />
            <Input label="الميزانية" type="number" value={form.budget} onChange={(e) => setForm({...form, budget: parseFloat(e.target.value) || 0})} className="col-span-2" />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>

      <Modal
        isOpen={showCloseModal}
        onClose={() => { setShowCloseModal(false); setClosingProject(null); }}
        title={`إقفال مشروع: ${closingProject?.name || ''}`}
        size="md"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowCloseModal(false); setClosingProject(null); }}>إلغاء</Button>
            <Button variant="danger" onClick={handleClose} disabled={closing}>{closing ? 'جاري الإقفال...' : 'إقفال المشروع'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 text-sm text-text-secondary">
            سيتم إقفال المشروع محاسبياً بإنشاء قيد إقفال ينقل أرصدة الإيرادات والمصروفات إلى حساب الأرباح المرحلة.
          </div>
          <Input label="تاريخ الإقفال" type="date" value={closeForm.close_date} onChange={(e) => setCloseForm({ ...closeForm, close_date: e.target.value })} />
          <Textarea label="ملاحظات الإقفال" value={closeForm.notes} onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })} placeholder="ملاحظات إقفال المشروع" />
          {closeError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{closeError}</div>}
        </div>
      </Modal>
    </div>
  );
}
