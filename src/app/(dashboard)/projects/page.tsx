'use client';

import { useState, useEffect } from 'react';
import { 
  Plus, Lock, FileText, CheckCircle, Trash2, Edit3, Loader2, DollarSign, 
  Layers, Calculator, ShieldCheck, Send, Key, ChevronDown, Landmark, ChevronLeft, ChevronRight
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { toDateInput } from '@/lib/form-utils';
import { useSidebarStore } from '@/store/sidebar-store';
import { useAuthStore } from '@/store/auth-store';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
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
    auto_invoice: false, // التوليد التلقائي للفاتورة
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
      const [projRes, cliRes, bankRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/clients'),
        fetch('/api/banks'), // جلب البنوك والخزائن للتحصيل الفوري
      ]);
      const [projJson, cliJson, bankJson] = await Promise.all([
        projRes.json(),
        cliRes.json(),
        bankRes.json(),
      ]);
      if (projJson.success) setProjects(projJson.data?.rows || projJson.data?.projects || []);
      else setError(projJson.message || 'فشل تحميل المشاريع');
      if (cliJson.success) setClients(cliJson.data?.clients || []);
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
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
      auto_invoice: false,
    });
    setSaveError('');
    setShowModal(true);
  };

  // إضافة سطر بند جديد لجدول كميات المشروع
  const addBoqRow = () => {
    setBoqItems([...boqItems, { description: '', unit: 'متر', quantity: 1, unit_price: 0, total: 0 }]);
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
    const sum = updated.reduce((s, item) => s + (item.total || 0), 0);
    setForm(prev => ({ ...prev, contract_value: sum }));
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
        items: boqItems.filter(item => item.description.trim() !== '')
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(editingProject ? 'تم تعديل المشروع بنجاح' : 'تم إنشاء المشروع وبنود الكميات وتوليد الفاتورة بنجاح! 🎉');
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
          auto_invoice: false,
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
          auto_invoice: false,
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
    }
  };

  const handleDelete = async (project: any) => {
    if (!confirm(`هل أنت متأكد تماماً من حذف المشروع "${project.name}"؟ سيتم حذف جميع بنود الكميات والمستندات التابعة له.`)) return;
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
        title={editingProject ? `تعديل مشروع: ${editingProject.name}` : '🏗️ إضافة مشروع جديد مدمج بجدول كميات (BOQ)'}
        size="full"
        footer={
          <div className="flex gap-2 w-full justify-between items-center">
            <div className="text-xs text-text-muted font-bold">
              إجمالي قيمة العقد: <span className="text-accent text-sm">{formatCurrency(form.contract_value)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setShowModal(false); setEditingProject(null); }}>إلغاء</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ والترحيل...' : 'حفظ المشروع والبنود'}</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="اسم المشروع المحاسبي *" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="col-span-2" placeholder="مثال: مشروع مجمع الفلل السكني" />
            <Select
              label="العميل المفوتر *"
              value={form.client_id}
              onChange={(v) => setForm({...form, client_id: v})}
              options={[{ value: '', label: 'اختر عميلاً' }, ...clients.map((c: any) => ({ value: c.id, label: c.name }))]}
              className="col-span-2"
            />
            <Input label="تاريخ البدء" type="date" value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} />
            <Input label="تاريخ الانتهاء المتوقع" type="date" value={form.end_date} onChange={(e) => setForm({...form, end_date: e.target.value})} />
            <Input label="الموقع / اللوكيشن" value={form.location} onChange={(e) => setForm({...form, location: e.target.value})} placeholder="مثال: الرياض - الياسمين" />
            <Input label="قيمة العقد الكلية" type="number" disabled value={form.contract_value} className="bg-bg-secondary font-mono font-bold text-accent" />
            <Checkbox label="توليد فاتورة مبيعات تلقائية مطابقة لكامل البنود مسبقاً 🧾" checked={form.auto_invoice} onChange={(checked: boolean) => setForm({...form, auto_invoice: checked})} className="col-span-2 text-accent font-semibold" />
          </div>

          {/* جدول الكميات التفاعلي المدمج (BOQ items nested inside project form) */}
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                <Layers size={16} className="text-accent" />
                تأسيس بنود جدول الكميات والمواصفات (BOQ)
              </h4>
              <Button type="button" size="sm" variant="outline" onClick={addBoqRow}>
                <Plus size={14} className="ml-1" /> إضافة بند كميات
              </Button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {boqItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 rounded-xl bg-bg-secondary border border-border">
                  <span className="text-xs font-mono font-bold text-text-muted">{idx + 1}</span>
                  <input 
                    type="text" 
                    placeholder="البيان (وصف أعمال البند)" 
                    value={item.description} 
                    onChange={(e) => handleBoqItemChange(idx, 'description', e.target.value)}
                    className="input-base !py-1 text-xs flex-1"
                  />
                  <input 
                    type="text" 
                    placeholder="الوحدة" 
                    value={item.unit} 
                    onChange={(e) => handleBoqItemChange(idx, 'unit', e.target.value)}
                    className="input-base !py-1 text-xs w-20 text-center"
                  />
                  <input 
                    type="number" 
                    placeholder="الكمية" 
                    value={item.quantity} 
                    onChange={(e) => handleBoqItemChange(idx, 'quantity', e.target.value)}
                    className="input-base !py-1 text-xs w-20 text-center font-mono"
                  />
                  <input 
                    type="number" 
                    placeholder="سعر الوحدة" 
                    value={item.unit_price} 
                    onChange={(e) => handleBoqItemChange(idx, 'unit_price', e.target.value)}
                    className="input-base !py-1 text-xs w-24 text-center font-mono"
                  />
                  <div className="w-24 text-left font-mono font-bold text-xs text-slate-800 pr-2">
                    {formatCurrency(item.total)}
                  </div>
                  {boqItems.length > 1 && (
                    <button 
                      onClick={() => removeBoqRow(idx)}
                      className="p-1 rounded text-red-500 hover:bg-red-50"
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

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

            <div className="grid grid-cols-2 gap-4">
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