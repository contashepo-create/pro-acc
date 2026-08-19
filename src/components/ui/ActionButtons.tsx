'use client';

import { useState } from 'react';
import { Edit, Trash2, Eye, Printer } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { RecordViewModal } from './RecordViewModal';
import { toast } from './Toast';
import { openPrintWindow } from '@/lib/print';
import { escapeHtml } from '@/lib/utils';

interface ActionButtonsProps {
  item: any;
  onEdit?: (item: any) => void;
  onDelete?: (item: any) => void;
  onView?: (item: any) => void;
  onPrint?: (item: any) => void;
  showView?: boolean;
  showPrint?: boolean;
  status?: string;
  showStatus?: boolean;
  deleteMode?: 'delete' | 'deactivate';
}

function defaultPrint(item: any) {
  const skip = new Set(['id', 'company_id', 'created_by', 'updated_at', 'deleted_at', 'password_hash', 'children']);
  const rows = Object.entries(item || {})
    .filter(([k, v]) => !skip.has(k) && v != null && typeof v !== 'object')
    .map(([k, v]) => `<tr><th style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(k)}</th><td style="padding:6px 12px;border-bottom:1px solid #eee;direction:ltr;unicode-bidi:isolate">${escapeHtml(String(v))}</td></tr>`)
    .join('');
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طباعة</title>
    <style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}h1{font-size:18px}table{width:100%;border-collapse:collapse}@media print{button{display:none}}</style>
    </head><body><h1>عرض السجل</h1><table>${rows}</table><p style="margin-top:24px"><button onclick="window.print()">طباعة</button></p></body></html>`;
  const result = openPrintWindow(html);
  if (!result.ok) {
    toast.error(
      result.blocked
        ? 'منع المتصفح فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.'
        : 'تعذر فتح نافذة الطباعة.',
    );
  }
}

export function ActionButtons({
  item,
  onEdit,
  onDelete,
  onView,
  onPrint,
  showView = true,
  showPrint = true,
  status,
  showStatus = false,
  deleteMode = 'delete',
}: ActionButtonsProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(item);
      setShowDeleteModal(false);
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
      approved: { variant: 'success', label: 'مؤكدة' },
      rejected: { variant: 'danger', label: 'مرفوضة' },
      pending: { variant: 'warning', label: 'قيد الانتظار' },
      paid: { variant: 'success', label: 'مدفوعة' },
      unpaid: { variant: 'warning', label: 'غير مدفوعة' },
      partial: { variant: 'info', label: 'جزئية' },
    };
    const m = map[status] || { variant: 'info', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  return (
    <>
      <div className="flex items-center gap-1">
        {showStatus && status && statusBadge(status)}

        {showView && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (onView ? onView(item) : setShowViewModal(true))}
            title="عرض التفاصيل"
            className="text-slate-600 hover:text-accent hover:bg-accent/10"
          >
            <Eye size={16} />
          </Button>
        )}

        {showPrint && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (onPrint ? onPrint(item) : defaultPrint(item))}
            title="طباعة"
            className="text-slate-600 hover:text-accent hover:bg-accent/10"
          >
            <Printer size={16} />
          </Button>
        )}

        {onEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(item)}
            title="تعديل السجل"
            className="text-blue-600 hover:bg-blue-50"
          >
            <Edit size={16} />
          </Button>
        )}

        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteModal(true)}
            title={deleteMode === 'deactivate' ? 'تعطيل' : 'حذف'}
            className="text-danger hover:bg-danger/10"
          >
            <Trash2 size={16} />
          </Button>
        )}
      </div>

      <RecordViewModal
        isOpen={showViewModal}
        onClose={() => setShowViewModal(false)}
        record={item}
      />

      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title={deleteMode === 'deactivate' ? 'تأكيد التعطيل' : 'تأكيد الحذف'}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
              إلغاء
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting
                ? (deleteMode === 'deactivate' ? 'جاري التعطيل...' : 'جاري الحذف...')
                : (deleteMode === 'deactivate' ? 'تعطيل' : 'حذف')}
            </Button>
          </div>
        }
      >
        <p>{deleteMode === 'deactivate' ? 'هل أنت متأكد من تعطيل هذا العنصر؟' : 'هل أنت متأكد من حذف هذا العنصر؟'}</p>
        <p className="text-sm text-text-muted mt-2">
          {deleteMode === 'deactivate'
            ? 'سيبقى السجل محفوظاً للرجوع إليه في الحركات والتقارير التاريخية.'
            : 'هذا الإجراء لا يمكن التراجع عنه.'}
        </p>
      </Modal>
    </>
  );
}
