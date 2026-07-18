'use client';

import { useState } from 'react';
import { Edit, Trash2, Eye } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import { Badge } from './Badge';

interface ActionButtonsProps {
  item: any;
  onEdit?: (item: any) => void;
  onDelete?: (item: any) => void;
  onView?: (item: any) => void;
  status?: string;
  showStatus?: boolean;
}

export function ActionButtons({ 
  item, 
  onEdit, 
  onDelete, 
  onView,
  status,
  showStatus = false 
}: ActionButtonsProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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
      'approved': { variant: 'success', label: 'مؤكدة' },
      'rejected': { variant: 'danger', label: 'مرفوضة' },
      'pending': { variant: 'warning', label: 'قيد الانتظار' },
      'paid': { variant: 'success', label: 'مدفوعة' },
      'unpaid': { variant: 'warning', label: 'غير مدفوعة' },
      'partial': { variant: 'info', label: 'جزئية' },
    };
    const m = map[status] || { variant: 'info', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {showStatus && status && statusBadge(status)}
        
        {onView && (
          <Button variant="ghost" size="sm" onClick={() => onView(item)} title="عرض">
            <Eye size={16} />
          </Button>
        )}
        
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={() => onEdit(item)} title="تعديل">
            <Edit size={16} className="text-blue-600" />
          </Button>
        )}
        
        {onDelete && (
          <Button variant="ghost" size="sm" onClick={() => setShowDeleteModal(true)} title="حذف">
            <Trash2 size={16} className="text-danger" />
          </Button>
        )}
      </div>

      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="تأكيد الحذف"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
              إلغاء
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'جاري الحذف...' : 'حذف'}
            </Button>
          </div>
        }
      >
        <p>هل أنت متأكد من حذف هذا العنصر؟</p>
        <p className="text-sm text-text-muted mt-2">هذا الإجراء لا يمكن التراجع عنه.</p>
      </Modal>
    </>
  );
}
