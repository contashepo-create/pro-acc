'use client';

import { useState, useEffect } from 'react';
import { 
  Plus, Lock, FileText, Trash2, Loader2, Layers, ShieldCheck,
} from 'lucide-react';
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
import { toDateInput } from '@/lib/form-utils';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]); // عروض الأسعار المقبولة للاستيراد
  const [banks, setBanks] = useState<any[]>([]); // جلب البنوك لغايات سند القبض الفوري
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // شاشات الإضافة والتعديل للمشاريع
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  
  // بنود جدول الكميات (BOQ) الخاصة بالمشروع الجديد
  const [boqItems, setBoqItems] = useState<any[]>([
    { description: '', unit: 'متر', quantity: 1, unit_price: 0, total: 0 }
  ]);

  const [form, setForm] = useState<any>({
    name: '',
    client_id: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    contract_value: 0,
    description: '',
    location: '',
  });

  // شاشات إغلاق المشروع
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingProject, setClosingProject] = useState<any>(null);
  const [closeForm, setCloseForm] = useState<any>({
    close_date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');

  // 🛑 شاشة الفاتورة النقدية والتحصيل الفوري المدمج من المشروع 🛑
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceProject, setInvoiceProject] = useState<any>(null);
  const [invoiceForm, setInvoiceForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date().toISOString().split('T')[0],
    vatRate: 0.15,
    collected_amount: 0, // المبلغ المحصل مسبقاً قبل الحفظ
    bank_safe_id: '', // البنك المستلم
    notes: '',
  });
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [projRes, cliRes, bankRes, quotRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/clients'),
        fetch('/api/banks'), // جلب البنوك والخزائن للتحصيل الفوري
        fetch('/api/quotations?status=accepted'),
      ]);
      const [projJson, cliJson, bankJson, quotJson] = await Promise.all([
        projRes.json(),
        cliRes.json(),
        bankRes.json(),
        quotRes.json(),
      ]);
      if (projJson.success) setProjects(projJson.data?.rows || projJson.data?.projects || []);
      else setError(projJson.message || 'فشل تحميل المشاريع');
      if (cliJson.success) setClients(cliJson.data?.clients || []);
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
      if (quotJson.success) setQuotations(quotJson.data?.quotations || []);
    } catch (err) {
      setError('فشل تحميل البيانات - خطأ في الاتصال بالخادم');
      console.error('Failed to fetch project data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // FIXED: Declared handleOpenAdd function inside the component to prevent ReferenceError
  const handleOpenAdd = () => {
    setEditingProject(null);
    setBoqItems([
      { description: '', unit: 'متر', quantity: 1, unit_price: 0, total: 0 }
    ]);
    setForm({
      name: '',
      client_id: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      contract_value: 0,
      description: '',
      location: '',
    });
    setSaveError('');
    setShowModal(true);
  };

  // إضافة سطر بند جديد لجدول كميات المشروع
  const addBoqRow = () => {
    setBoqItems([...boqItems, { description: '', unit: 'متر', quantity: 1, unit_price: 0, total: 0 }]);
  };

  // استيراد بنود عرض سعر مقبول كبنود كميات للمشروع — تُستورد قيمة البند
  // الصافية (بدون ضريبة القيمة المضافة التي تظهر فقط في إجماليات العرض).
  const importFromQuotation = async (quotationId: string) => {
    if (!quotationId) return;
    try {
      const res = await fetch(`/api/quotations/${quotationId}`);
      const json = await res.json();
      if (!json.success) {
        toast.error(json.message || 'تعذر استيراد عرض السعر');
        return;
      }
      const d = json.data;
      const items = (d.items || []).map((it: any) => ({
        description: String(it.description || '').trim(),
        unit: String(it.unit || 'وحدة').trim(),
        quantity: Number(it.quantity) || 1,
        unit_price: Number(it.unit_price) || 0,
        total: (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
      }));
      if (items.length === 0) {
        toast.error('عرض السعر المحدد لا يحتوي على بنود');
        return;
      }
      const sum = items.reduce((s: number, it: any) => s + (it.total || 0), 0);
      setBoqItems(items);
      setForm((prev: any) => ({
        ...prev,
        // إجمالي العقد = صافي البنود بدون ضريبة
        contract_value: sum,
        // ربط العميل تلقائياً من العرض إن لم يكن محدداً
        client_id: prev.client_id || d.contact_id || '',
      }));
      toast.success(`تم استيراد ${items.length} بند من عرض السعر بقيمة صافية ${sum.toLocaleString('en')}`);
    } catch (e) {
      console.error('Failed to import quotation:', e);
      toast.error('تعذر استيراد عرض السعر');
    }
  };

  // حذف سطر بند من جدول الكميات
  const removeBoqRow = (index: number) => {
    if (boqItems.length <= 1) return;
    setBoqItems(boqItems.filter((_, i) => i !== index));
  };

  // تعديل بيانات سطر بند جدول الكميات
  const handleBoqItemChange = (index: number, field: string, value: any) => {
    const updated = boqItems.map((item, i) => {
      if (i === index) {
        const newItem = { ...item, [field]: value };
        // حساب إجمالي السطر تلقائياً
        if (field === 'quantity' || field === 'unit_price') {
          const qty = field === 'quantity' ? parseFloat(value) || 0 : item.quantity;
          const price = field === 'unit_price' ? parseFloat(value) || 0 : item.unit_price;
          newItem.total = qty * price;
        }
        return newItem;
      }
      return item;
    });
    setBoqItems(updated);

    // تحديث إجمالي قيمة العقد تلقائياً في فورم المشروع الرئيسي
    const sum = updated.reduce((s: number, item: { total?: number }) => s + (item.total || 0), 0);
    setForm((prev: Record<string, unknown>) => ({ ...prev, contract_value: sum }));
  };

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

      // دمج بنود جدول الكميات (BOQ) مع بيانات المشروع لإرسالها بالكامل في طلب واحد
      const payload = {
        ...form,
        items: boqItems.filter(item => item.description.trim() !== '').map((item) => ({
          description: String(item.description).trim(),
          unit: String(item.unit || 'واحدة').trim(),
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
        })),
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(editingProject ? 'تم تعديل المشروع بنجاح' : 'تم إنشاء المشروع وبنود الكميات بنجاح');
        setShowModal(false);
        setEditingProject(null);
        setBoqItems([{ description: '', unit: 'متر', quantity: 1, unit_price: 0, total: 0 }]);
        setForm({
          name: '',
          client_id: '',
          start_date: new Date().toISOString().split('T')[0],
          end_date: '',
          contract_value: 0,
          description: '',
          location: '',
        });
        fetchData();
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
        const d = json.data;
        setForm({
          name: d.name || '',
          client_id: d.client_id || d.contact_id || '',
          start_date: toDateInput(d.start_date),
          end_date: toDateInput(d.end_date),
          contract_value: d.contract_value || 0,
          description: d.description || '',
          location: d.location || '',
        });
        setBoqItems((d.boq_items || []).length
          ? d.boq_items
          : [{ description: '', unit: 'متر', quantity: 1, unit_price: 0, total: 0 }]);
        setShowModal(true);
      } else {
        toast.error(json.message || 'تعذر تحميل المشروع');
      }
    } catch (e) {
      console.error('Failed to load project:', e);
      toast.error('تعذر تحميل المشروع');
    }
  };

  const handleDelete = async (project: any) => {
    if (!confirm(`هل تريد إلغاء المشروع "${project.name}"؟ لا يمكن إلغاء مشروع له آثار مالية قائمة، ولن تُحذف السجلات التاريخية.`)) return;
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم حذف المشروع ومشتملاته بنجاح');
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  // فتح شاشة الفاتورة والتحصيل المباشر
  const openInvoiceModal = (project: any) => {
    if (!project.client_id) {
      toast.error('يجب ربط المشروع بعميل أولاً لكي تتمكن من إصدار فاتورة له');
      return;
    }
    setInvoiceProject(project);
    setInvoiceError('');
    setInvoiceForm({
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date().toISOString().split('T')[0],
      vatRate: 0.15,
      collected_amount: project.contract_value || 0, // المبلغ الافتراضي للتحصيل الفوري
      bank_safe_id: '',
      notes: `فاتورة مبيعات وتحصيل فوري للمشروع: ${project.name}`,
    });
    setShowInvoiceModal(true);
  };

  // ترحيل وحفظ الفاتورة المدمجة والتحصيل الفوري
  const handleSaveInvoiceWithPayment = async () => {
    if (Number(invoiceForm.collected_amount) > 0 && !invoiceForm.bank_safe_id) {
      setInvoiceError('يجب تحديد "الخزينة/البنك" التي تود إيداع واستلام المبلغ المحصل عليها');
      return;
    }

    setInvoiceLoading(true);
    setInvoiceError('');

    try {
      // بناء بنود الفاتورة مطابقة تماماً لجدول كميات المشروع (BOQ)
      const invoiceItems = (invoiceProject.boq_items || []).map((item: any) => ({
        description: item.description,
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unit_price) || 0,
        total: Number(item.total) || 0
      }));

      // في حال عدم وجود بنود كميات سابقة، نضع بند المشروع الافتراضي
      if (invoiceItems.length === 0) {
        invoiceItems.push({
          description: `أعمال مشروع: ${invoiceProject.name}`,
          quantity: 1,
          unitPrice: Number(invoiceProject.contract_value),
          total: Number(invoiceProject.contract_value)
        });
      }

      const subtotal = invoiceProject.contract_value;
      const vatAmount = subtotal * Number(invoiceForm.vatRate);
      const total = subtotal + vatAmount;

      const payload = {
        clientId: invoiceProject.client_id,
        projectId: invoiceProject.id,
        date: invoiceForm.date,
        dueDate: invoiceForm.dueDate,
        items: invoiceItems,
        subtotal,
        vatRate: Number(invoiceForm.vatRate),
        vatAmount,
        total,
        notes: invoiceForm.notes,
        
        // حقول التحصيل المباشر
        collected_amount: Number(invoiceForm.collected_amount),
        bank_safe_id: invoiceForm.bank_safe_id,
        payment_method: 'instapay'
      };

      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();

      if (json.success) {
        toast.success(`🎉 تم إصدار الفاتورة مبيعات رقم #${json.data.number} وإنشاء سند القبض التلقائي وترحيل القيد المتزن بنجاح!`);
        setShowInvoiceModal(false);
        fetchData();
      } else {
        setInvoiceError(json.message || 'فشل ترحيل الفاتورة');
      }
    } catch {
      setInvoiceError('حدث خطأ في الاتصال بالخادم أثناء معالجة الترحيل المحاسبي');
    } finally {
      setInvoiceLoading(false);
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
        fetchData();
      } else {
        setCloseError(json.message || 'فشل الإقفال');
      }
    } catch (e: any) { 
      setCloseError('خطأ في الاتصال'); 
    } finally { 
      setClosing(false); 
    }
  };

  const [statusTab, setStatusTab] = useState('all');
  const filtered = statusTab === 'all' ? projects : projects.filter(p => p.status === statusTab);

  const columns = [
    { key: 'name', label: 'اسم المشروع', sortable: true,
      render: (row: any) => (
        <div className="space-y-1 text-right">
          <div className="font-bold text-slate-800">{row.name}</div>
          <div className="text-[10px] text-slate-400">BOQ: {row.boq_items?.length || 0} بند كميات جاهز</div>
        </div>
      )
    },
    { key: 'client_name', label: 'العميل', sortable: true },
    { key: 'start_date', label: 'تاريخ البدء', render: (row: any) => formatDate(row.start_date) },
    { key: 'contract_value', label: 'قيمة العقد / الميزانية', render: (row: any) => formatCurrency(row.contract_value) },
    { key: 'status', label: 'الحالة', render: (row: any) => (
      <Badge variant={row.status === 'active' ? 'success' : row.status === 'completed' ? 'info' : 'warning'}>
        {row.status === 'active' ? 'نشط' : row.status === 'completed' ? 'مكتمل' : 'معلّق'}
      </Badge>
    )},
    {
      key: 'actions',
      label: 'إجراءات متكاملة',
      render: (row: any) => (
        <div className="flex items-center gap-2">
          {row.status === 'active' && (
            <>
              {/* زر إصدار فاتورة وتحصيل نقدي فوري مدمج كقالب عالمي */}
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => openInvoiceModal(row)} 
                title="إصدار فاتورة مبيعات وتحصيل فوري للعميل 📥"
                className="text-emerald-600 hover:bg-emerald-50"
              >
                <FileText size={16} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openCloseModal(row)} title="إقفال المشروع 🔒">
                <Lock size={16} className="text-orange-600" />
              </Button>
            </>
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
        title="المشاريع الهندسية و الميزانيات"
        description="تتبع دورة حياة عقود المقاولات من عروض الأسعار والبنود والتحصيل"
        actions={
          <Button onClick={handleOpenAdd} leftIcon={<Plus size={18} />}>
            إضافة مشروع مدمج بجدول الكميات
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
        <EmptyState title="لا توجد مشاريع" actionLabel="إضافة مشروع" onAction={handleOpenAdd} />
      ) : (
        <DataTable columns={columns} data={filtered} searchable searchKeys={['name', 'client_name']} />
      )}

      {/* ===================== نافذة إضافة مشروع وجدول كميات مدمج ===================== */}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingProject(null); }}
        title={editingProject ? `تعديل مشروع: ${editingProject.name}` : 'إضافة مشروع جديد'}
        size="full"
        footer={
          <div className="flex gap-2 w-full justify-between items-center">
            <div className="text-sm text-text-muted">
              إجمالي قيمة العقد (بدون ضريبة):
              <span className="font-mono font-bold text-accent text-base mr-2">{formatCurrency(form.contract_value)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setShowModal(false); setEditingProject(null); }}>إلغاء</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ المشروع'}</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-6">
          {/* البيانات الأساسية */}
          <section className="rounded-2xl border border-border bg-bg-card p-5">
            <h4 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-accent" /> البيانات الأساسية للمشروع
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="اسم المشروع *"
                value={form.name}
                onChange={(e) => setForm({...form, name: e.target.value})}
                className="md:col-span-2"
                placeholder="مثال: مشروع مجمع الفلل السكني"
              />
              <Select
                label="العميل (مرجعي فقط — لا يؤثر على رصيده)"
                value={form.client_id}
                onChange={(v) => setForm({...form, client_id: v})}
                options={[{ value: '', label: 'اختر عميلاً (اختياري)' }, ...clients.map((c: any) => ({ value: c.id, label: c.name }))]}
                className="md:col-span-2"
              />
              <Input label="تاريخ البدء *" type="date" value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} />
              <Input label="تاريخ الانتهاء المتوقع" type="date" value={form.end_date} onChange={(e) => setForm({...form, end_date: e.target.value})} />
              <Input label="الموقع" value={form.location} onChange={(e) => setForm({...form, location: e.target.value})} placeholder="مثال: الرياض - الياسمين" />
              <div className="rounded-xl bg-bg-secondary px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm text-text-muted">قيمة العقد (تُحتسب تلقائياً من البنود)</span>
                <span className="font-mono font-bold text-accent text-lg">{formatCurrency(form.contract_value)}</span>
              </div>
            </div>
            <Textarea
              label="وصف المشروع"
              value={form.description}
              onChange={(e) => setForm({...form, description: e.target.value})}
              placeholder="وصف مختصر لنطاق الأعمال والملاحظات..."
              className="mt-4"
            />
          </section>

          {/* استيراد من عرض سعر + جدول الكميات */}
          <section className="rounded-2xl border border-border bg-bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h4 className="text-sm font-bold text-text-primary flex items-center gap-2">
                <span className="w-1.5 h-5 rounded-full bg-accent" /> بنود جدول الكميات (BOQ)
              </h4>
              <div className="flex flex-wrap items-center gap-2">
                {!editingProject && quotations.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Select
                      label=""
                      value=""
                      onChange={(v) => { if (v) importFromQuotation(v); }}
                      options={[
                        { value: '', label: 'استيراد من عرض سعر مقبول...' },
                        ...quotations.map((q: any) => ({ value: q.id, label: `عرض #${q.number} — ${q.contact_name || ''}` })),
                      ]}
                      className="w-64"
                    />
                  </div>
                )}
                <Button type="button" size="sm" variant="outline" onClick={addBoqRow}>
                  <Plus size={14} className="ml-1" /> إضافة بند
                </Button>
              </div>
            </div>

            {/* رأس الجدول */}
            <div className="hidden md:grid grid-cols-[2.5rem_1fr_6rem_7rem_9rem_9rem_2.5rem] gap-2 px-3 pb-2 text-[11px] font-bold text-text-muted">
              <span className="text-center">#</span>
              <span>البيان / وصف الأعمال</span>
              <span className="text-center">الوحدة</span>
              <span className="text-center">الكمية</span>
              <span className="text-center">سعر الوحدة</span>
              <span className="text-left">الإجمالي</span>
              <span></span>
            </div>

            <div className="space-y-2 max-h-[22rem] overflow-y-auto pr-1">
              {boqItems.map((item, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 md:grid-cols-[2.5rem_1fr_6rem_7rem_9rem_9rem_2.5rem] gap-2 items-center p-2 rounded-xl bg-bg-secondary border border-border"
                >
                  <span className="hidden md:block text-center text-xs font-mono font-bold text-text-muted">{idx + 1}</span>
                  <div className="md:col-start-1 md:hidden text-xs font-mono text-text-muted">بند {idx + 1}</div>
                  <input
                    type="text"
                    placeholder="وصف أعمال البند (مثال: أعمال الحفر والردم)"
                    value={item.description}
                    onChange={(e) => handleBoqItemChange(idx, 'description', e.target.value)}
                    className="input-base !py-2 text-sm"
                  />
                  <div className="grid grid-cols-4 md:contents gap-2">
                    <input
                      type="text"
                      placeholder="الوحدة"
                      value={item.unit}
                      onChange={(e) => handleBoqItemChange(idx, 'unit', e.target.value)}
                      className="input-base !py-2 text-sm text-center"
                    />
                    <input
                      type="number"
                      placeholder="الكمية"
                      value={item.quantity}
                      onChange={(e) => handleBoqItemChange(idx, 'quantity', e.target.value)}
                      className="input-base !py-2 text-sm text-center font-mono"
                    />
                    <input
                      type="number"
                      placeholder="سعر الوحدة"
                      value={item.unit_price}
                      onChange={(e) => handleBoqItemChange(idx, 'unit_price', e.target.value)}
                      className="input-base !py-2 text-sm text-center font-mono"
                    />
                    <div className="flex items-center justify-end md:justify-start font-mono font-bold text-sm text-text-primary">
                      {formatCurrency(item.total)}
                    </div>
                  </div>
                  <div className="flex items-center justify-end">
                    {boqItems.length > 1 && (
                      <button
                        onClick={() => removeBoqRow(idx)}
                        className="p-2 rounded-lg text-danger hover:bg-danger/10"
                        type="button"
                        aria-label="حذف البند"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>

      {/* ===================== شاشة إصدار الفاتورة المدمجة والتحصيل الفوري 📥 ===================== */}
      <Modal
        isOpen={showInvoiceModal}
        onClose={() => { setShowInvoiceModal(false); setInvoiceProject(null); }}
        title={`📥 إصدار فاتورة مبيعات وتحصيل فوري مدمج للمشروع: ${invoiceProject?.name || ''}`}
        size="full"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowInvoiceModal(false); setInvoiceProject(null); }}>إلغاء</Button>
            <Button onClick={handleSaveInvoiceWithPayment} disabled={invoiceLoading}>
              {invoiceLoading ? 'جاري ترحيل الفاتورة والسند...' : 'حفظ الفاتورة وتأكيد ترحيل السند 📥'}
            </Button>
          </div>
        }
      >
        {invoiceProject && (
          <div className="space-y-4">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs leading-relaxed flex items-start gap-2">
              <ShieldCheck size={18} className="shrink-0" />
              <div>
                <strong>نظام ترحيل مدمج متزن أمنياً ماليًا:</strong>
                <br />
                سيقوم النظام تلقائياً بإنشاء فاتورة مبيعات ضريبية متضمنة تفاصيل كامل بنود كميات المشروع المعتمدة (BOQ)، وإنشاء سند قبض تلقائي بقيمة "المبلغ المحصل"، وترحيل قيد مزدوج متزن فوري يتأثر به رصيد حساب العميل المساعد فوراً!
              </div>
            </div>

            {invoiceError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
                ⚠️ {invoiceError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="تاريخ الفاتورة" type="date" value={invoiceForm.date} onChange={(e) => setInvoiceForm({...invoiceForm, date: e.target.value})} />
              <Input label="تاريخ الاستحقاق" type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm({...invoiceForm, dueDate: e.target.value})} />
              <Select
                label="نسبة الضريبة"
                value={String(invoiceForm.vatRate)}
                onChange={(v) => setInvoiceForm({...invoiceForm, vatRate: Number(v)})}
                options={[
                  { value: '0.15', label: 'ضريبة القيمة المضافة 15% (الأساسي)' },
                  { value: '0', label: 'معفى من الضريبة 0%' }
                ]}
              />
              <Input 
                label="المبلغ المحصل مسبقاً (دفعة مقدمة/جارية)" 
                type="number" 
                value={invoiceForm.collected_amount} 
                onChange={(e) => setInvoiceForm({...invoiceForm, collected_amount: parseFloat(e.target.value) || 0})} 
              />
              {Number(invoiceForm.collected_amount) > 0 && (
                <Select
                  label="إيداع واستلام المقبوضات على الخزينة/البنك *"
                  value={invoiceForm.bank_safe_id}
                  onChange={(v) => setInvoiceForm({...invoiceForm, bank_safe_id: v})}
                  options={[{ value: '', label: 'اختر البنك أو الخزينة المودع عليها' }, ...banks.map((b: any) => ({ value: b.id, label: b.name }))]}
                  className="col-span-2"
                />
              )}
              <Textarea 
                label="البيان والملاحظات" 
                value={invoiceForm.notes} 
                onChange={(e) => setInvoiceForm({...invoiceForm, notes: e.target.value})}
                className="col-span-2 h-16"
              />
            </div>

            {/* الفوائد والبيانات الحسابية المتوقعة */}
            <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2 text-xs text-text-secondary text-right">
              <div className="flex justify-between">
                <span>إجمالي قيمة الأعمال للمشروع (قبل الضريبة)</span>
                <span className="font-bold text-slate-800 font-mono">{formatCurrency(invoiceProject.contract_value)}</span>
              </div>
              <div className="flex justify-between">
                <span>قيمة ضريبة القيمة المضافة ({invoiceForm.vatRate * 100}%)</span>
                <span className="font-bold text-slate-800 font-mono">{formatCurrency(invoiceProject.contract_value * invoiceForm.vatRate)}</span>
              </div>
              <div className="flex justify-between border-t pt-1.5 font-bold text-slate-800">
                <span>الإجمالي شامل الضريبة</span>
                <span className="font-mono text-sm text-accent">{formatCurrency(invoiceProject.contract_value * (1 + invoiceForm.vatRate))}</span>
              </div>
              {Number(invoiceForm.collected_amount) > 0 && (
                <div className="flex justify-between text-green-600 font-semibold border-t pt-1">
                  <span>المبلغ المسدد نقداً فوراُ (المحصل حالياً)</span>
                  <span className="font-mono">-{formatCurrency(Number(invoiceForm.collected_amount))}</span>
                </div>
              )}
              <div className="flex justify-between text-red-500 font-semibold border-t pt-1">
                <span>المتبقي الآجل على ذمة العميل للتحصيل لاحقاً</span>
                <span className="font-mono">{formatCurrency(Math.max(0, (invoiceProject.contract_value * (1 + invoiceForm.vatRate)) - Number(invoiceForm.collected_amount)))}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ===================== شاشة إقفال المشروع ===================== */}
      <Modal
        isOpen={showCloseModal}
        onClose={() => { setShowCloseModal(false); setClosingProject(null); }}
        title={`🔒 إقفال مشروع: ${closingProject?.name || ''}`}
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
            سيتم إقفال المشروع محاسبياً وتجميد قبول أي عمليات أو فواتير إضافية عليه ماليًا.
          </div>
          <Input label="تاريخ الإقفال" type="date" value={closeForm.close_date} onChange={(e) => setCloseForm({ ...closeForm, close_date: e.target.value })} />
          <Textarea label="ملاحظات الإقفال" value={closeForm.notes} onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })} placeholder="ملاحظات إقفال المشروع" />
          {closeError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{closeError}</div>}
        </div>
      </Modal>
    </div>
  );
}