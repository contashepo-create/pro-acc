'use client';

import { useState, useEffect } from 'react';
import { Shield, ShieldCheck, ShieldOff, Users, Settings, ChevronDown, ChevronUp, Save, AlertCircle, Check, X, UserCog, Lock, Unlock, Send, SendOff } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Switch } from '@/components/ui/Switch';
import { Tabs } from '@/components/ui/Tabs';

// الوحدات المتاحة
const MODULE_GROUPS: Record<string, { label: string; icon: string; modules: { key: string; label: string }[] }> = {
  financial: {
    label: 'الوحدات المالية',
    icon: '💰',
    modules: [
      { key: 'invoices', label: 'الفواتير' },
      { key: 'vouchers', label: 'السندات' },
      { key: 'receipts', label: 'سندات القبض' },
      { key: 'disbursements', label: 'سندات الصرف' },
      { key: 'journal', label: 'القيود المحاسبية' },
      { key: 'cash', label: 'الخزينة' },
      { key: 'banks', label: 'البنوك' },
    ],
  },
  accounts: {
    label: 'الحسابات',
    icon: '📊',
    modules: [
      { key: 'accounts', label: 'شجرة الحسابات' },
      { key: 'clients', label: 'العملاء' },
      { key: 'contacts', label: 'جهات الاتصال' },
      { key: 'employees', label: 'الموظفين' },
      { key: 'subcontractors', label: 'مقاولي الباطن' },
    ],
  },
  projects: {
    label: 'المشاريع',
    icon: '🏗️',
    modules: [
      { key: 'projects', label: 'المشاريع' },
      { key: 'boq', label: 'جدول الكميات' },
      { key: 'progress_billing', label: 'فوترة تقدم' },
    ],
  },
  purchases: {
    label: 'المشتريات',
    icon: '🛒',
    modules: [
      { key: 'purchase_orders', label: 'أوامر الشراء' },
      { key: 'purchase_invoices', label: 'فواتير الشراء' },
    ],
  },
  inventory: {
    label: 'المخزون',
    icon: '📦',
    modules: [
      { key: 'inventory', label: 'المخزون' },
      { key: 'warehouses', label: 'المستودعات' },
      { key: 'inventory_transactions', label: 'حركات المخزون' },
    ],
  },
  assets: {
    label: 'الأصول والعهدة',
    icon: '🏢',
    modules: [
      { key: 'fixed_assets', label: 'الأصول الثابتة' },
      { key: 'custodies', label: 'العهدة' },
    ],
  },
  payroll: {
    label: 'الرواتب',
    icon: '💼',
    modules: [
      { key: 'payroll', label: 'الرواتب' },
      { key: 'salary_sheets', label: 'كشف الرواتب' },
      { key: 'employee_advances', label: 'سلف الموظفين' },
    ],
  },
  admin: {
    label: 'الإدارة',
    icon: '⚙️',
    modules: [
      { key: 'users', label: 'المستخدمين' },
      { key: 'settings', label: 'الإعدادات' },
      { key: 'reports', label: 'التقارير' },
      { key: 'subscription', label: 'الاشتراك' },
    ],
  },
};

// العمليات المتاحة
const ALL_ACTIONS = [
  { key: 'create', label: 'إنشاء', icon: '➕', color: 'bg-green-100 text-green-700' },
  { key: 'read', label: 'عرض', icon: '👁️', color: 'bg-blue-100 text-blue-700' },
  { key: 'update', label: 'تعديل', icon: '✏️', color: 'bg-yellow-100 text-yellow-700' },
  { key: 'delete', label: 'حذف', icon: '🗑️', color: 'bg-red-100 text-red-700' },
  { key: 'approve', label: 'موافقة', icon: '✅', color: 'bg-purple-100 text-purple-700' },
  { key: 'export', label: 'تصدير', icon: '📤', color: 'bg-indigo-100 text-indigo-700' },
  { key: 'print', label: 'طباعة', icon: '🖨️', color: 'bg-gray-100 text-gray-700' },
];

// الصلاحيات الافتراضية لكل دور
const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: ['create', 'read', 'update', 'delete', 'approve', 'export', 'print'],
  manager: ['create', 'read', 'update', 'delete', 'approve', 'export', 'print'],
  accountant: ['create', 'read', 'update', 'export', 'print'],
  supervisor: ['read', 'export', 'print'],
};

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin: { label: 'مدير النظام', color: 'bg-red-100 text-red-700 border-red-200' },
  manager: { label: 'مدير', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  accountant: { label: 'محاسب', color: 'bg-green-100 text-green-700 border-green-200' },
  supervisor: { label: 'مراقب', color: 'bg-gray-100 text-gray-700 border-gray-200' },
};

export default function PermissionsPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [bypassTelegram, setBypassTelegram] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState('users');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/permissions');
      const json = await res.json();
      if (json.success) {
        setUsers(json.data?.users || []);
      } else {
        setError(json.message || 'فشل تحميل البيانات');
      }
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const openPermissionsModal = async (user: any) => {
    setSelectedUser(user);
    setSaveMessage('');
    
    // جلب صلاحيات المستخدم
    try {
      const res = await fetch(`/api/permissions?userId=${user.id}`);
      const json = await res.json();
      
      if (json.success) {
        const data = json.data;
        const customPerms: Record<string, string[]> = {};
        let bypass = false;
        
        for (const perm of data.customPermissions || []) {
          customPerms[perm.module] = perm.permissions || [];
          if (perm.bypass_telegram_confirmation) bypass = true;
        }
        
        setPermissions(customPerms);
        setBypassTelegram(bypass);
      } else {
        setPermissions({});
        setBypassTelegram(false);
      }
    } catch {
      setPermissions({});
      setBypassTelegram(false);
    }
    
    // توسيع كل المجموعات
    const expanded: Record<string, boolean> = {};
    Object.keys(MODULE_GROUPS).forEach(k => expanded[k] = true);
    setExpandedGroups(expanded);
    
    setShowPermissionsModal(true);
  };

  const toggleAction = (module: string, action: string) => {
    setPermissions(prev => {
      const current = prev[module] || [];
      if (current.includes(action)) {
        return { ...prev, [module]: current.filter(a => a !== action) };
      } else {
        return { ...prev, [module]: [...current, action] };
      }
    });
  };

  const setAllForModule = (module: string, actions: string[]) => {
    setPermissions(prev => ({ ...prev, [module]: actions }));
  };

  const resetToDefaults = () => {
    if (!selectedUser) return;
    const role = selectedUser.role;
    const defaults = ROLE_DEFAULTS[role] || [];
    const newPerms: Record<string, string[]> = {};
    Object.values(MODULE_GROUPS).forEach(group => {
      group.modules.forEach(mod => {
        newPerms[mod.key] = [...defaults];
      });
    });
    setPermissions(newPerms);
  };

  const clearAllPermissions = () => {
    setPermissions({});
  };

  const handleSave = async () => {
    if (!selectedUser) return;
    setSaving(true);
    setSaveMessage('');

    try {
      // حفظ كل وحدة
      const allModules = Object.values(MODULE_GROUPS).flatMap(g => g.modules.map(m => m.key));
      
      for (const module of allModules) {
        const actions = permissions[module] || [];
        await fetch('/api/permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: selectedUser.id,
            module,
            actions,
            bypass_telegram: bypassTelegram,
          }),
        });
      }

      setSaveMessage('✅ تم حفظ الصلاحيات بنجاح');
      fetchUsers();
    } catch {
      setSaveMessage('❌ فشل حفظ الصلاحيات');
    } finally {
      setSaving(false);
    }
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const getModuleActions = (module: string): string[] => {
    return permissions[module] || ROLE_DEFAULTS[selectedUser?.role] || [];
  };

  const isModuleCustomized = (module: string): boolean => {
    return permissions[module] !== undefined;
  };

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="الصلاحيات" description="إدارة صلاحيات المستخدمين والوحدات" />
        <LoadingSkeleton variant="table" count={5} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader 
        title="إدارة الصلاحيات" 
        description="التحكم في صلاحيات المستخدمين والوصول للوحدات المختلفة"
        actions={
          <div className="flex gap-2">
            <Badge variant="info">{users.length} مستخدم</Badge>
          </div>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 flex items-center gap-2">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* بطاقات الأدوار */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(ROLE_LABELS).map(([role, info]) => {
          const count = users.filter(u => u.role === role).length;
          return (
            <Card key={role} className="text-center p-4">
              <Badge className={`${info.color} border mb-2`}>{info.label}</Badge>
              <div className="text-2xl font-bold text-gray-800">{count}</div>
              <div className="text-sm text-gray-500">مستخدم</div>
            </Card>
          );
        })}
      </div>

      {/* قائمة المستخدمين */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users size={20} />
            المستخدمون والصلاحيات
          </h3>
        </div>
        
        <div className="divide-y">
          {users.map(user => {
            const roleInfo = ROLE_LABELS[user.role] || { label: user.role, color: 'bg-gray-100 text-gray-700' };
            const hasCustomPerms = user.permissions && user.permissions.length > 0;
            
            return (
              <div key={user.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">
                    {user.name?.charAt(0) || '?'}
                  </div>
                  <div>
                    <div className="font-medium text-gray-800">{user.name}</div>
                    <div className="text-sm text-gray-500">{user.email}</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Badge className={`${roleInfo.color} border`}>{roleInfo.label}</Badge>
                  
                  {hasCustomPerms && (
                    <Badge variant="warning">
                      <ShieldCheck size={14} className="ml-1" />
                      صلاحيات مخصصة
                    </Badge>
                  )}

                  {!user.is_active && (
                    <Badge variant="danger">
                      <ShieldOff size={14} className="ml-1" />
                      غير نشط
                    </Badge>
                  )}
                  
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => openPermissionsModal(user)}
                    className="flex items-center gap-1"
                  >
                    <UserCog size={16} />
                    الصلاحيات
                  </Button>
                </div>
              </div>
            );
          })}
          
          {users.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              <Users size={48} className="mx-auto mb-4 text-gray-300" />
              <p>لا يوجد مستخدمون بعد</p>
            </div>
          )}
        </div>
      </Card>

      {/* نافذة تعديل الصلاحيات */}
      <Modal 
        isOpen={showPermissionsModal} 
        onClose={() => setShowPermissionsModal(false)} 
        title={`صلاحيات: ${selectedUser?.name || ''}`} 
        size="xl"
        footer={
          <div className="flex justify-between items-center w-full">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={resetToDefaults}>
                استعادة الافتراضي للدور
              </Button>
              <Button size="sm" variant="ghost" onClick={clearAllPermissions}>
                مسح الكل
              </Button>
            </div>
            <div className="flex gap-2 items-center">
              {saveMessage && (
                <span className={`text-sm ${saveMessage.includes('✅') ? 'text-green-600' : 'text-red-600'}`}>
                  {saveMessage}
                </span>
              )}
              <Button variant="ghost" onClick={() => setShowPermissionsModal(false)}>إلغاء</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'جاري الحفظ...' : 'حفظ الصلاحيات'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* إعداد تخطي التيليجرام */}
          <Card className="bg-amber-50 border-amber-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Send size={20} className="text-amber-600" />
                <div>
                  <div className="font-medium text-amber-800">تخطي تأكيد التيليجرام</div>
                  <div className="text-sm text-amber-600">
                    عند تفعيل هذا الخيار، لن يحتاج هذا المستخدم لتأكيد التيليجرام عند المعاملات الكبيرة
                  </div>
                </div>
              </div>
              <Switch 
                checked={bypassTelegram} 
                onChange={(v) => setBypassTelegram(v)} 
              />
            </div>
          </Card>

          {/* معلومات الدور */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-sm text-blue-700">
              <strong>الدور الحالي:</strong> {ROLE_LABELS[selectedUser?.role]?.label || selectedUser?.role}
              <span className="mx-2">|</span>
              <strong>الصلاحيات الافتراضية:</strong>
              {ROLE_DEFAULTS[selectedUser?.role]?.map(action => {
                const actionInfo = ALL_ACTIONS.find(a => a.key === action);
                return actionInfo ? (
                  <span key={action} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs mr-1 ${actionInfo.color}`}>
                    {actionInfo.icon} {actionInfo.label}
                  </span>
                ) : null;
              })}
            </div>
          </div>

          {/* الوحدات والصلاحيات */}
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {Object.entries(MODULE_GROUPS).map(([groupKey, group]) => (
              <div key={groupKey} className="border rounded-lg overflow-hidden">
                {/* رأس المجموعة */}
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className="font-medium flex items-center gap-2">
                    <span>{group.icon}</span>
                    {group.label}
                  </span>
                  {expandedGroups[groupKey] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>

                {/* محتوى المجموعة */}
                {expandedGroups[groupKey] && (
                  <div className="divide-y">
                    {group.modules.map(mod => {
                      const actions = getModuleActions(mod.key);
                      const isCustom = isModuleCustomized(mod.key);
                      
                      return (
                        <div key={mod.key} className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm flex items-center gap-2">
                              {mod.label}
                              {isCustom && (
                                <Badge variant="warning" className="text-xs">مخصص</Badge>
                              )}
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => setAllForModule(mod.key, ALL_ACTIONS.map(a => a.key))}
                                className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100"
                                title="تحديد الكل"
                              >
                                الكل
                              </button>
                              <button
                                onClick={() => setAllForModule(mod.key, [])}
                                className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100"
                                title="إلغاء الكل"
                              >
                                لا شيء
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-2">
                            {ALL_ACTIONS.map(action => {
                              const isActive = actions.includes(action.key);
                              return (
                                <button
                                  key={action.key}
                                  onClick={() => toggleAction(mod.key, action.key)}
                                  className={`
                                    flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-all border
                                    ${isActive 
                                      ? `${action.color} border-current font-medium` 
                                      : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                                    }
                                  `}
                                >
                                  <span>{action.icon}</span>
                                  <span>{action.label}</span>
                                  {isActive && <Check size={12} />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
