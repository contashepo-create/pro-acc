'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // FIXED: Added missing useRouter import for page-level redirection
import { useAuthStore } from '@/store/auth-store'; // FIXED: Added missing useAuthStore import
import { Shield, ShieldCheck, ShieldOff, Users, Settings, ChevronDown, ChevronUp, Save, AlertCircle, Check, X, UserCog, Lock, Unlock, Send, SendOff, Plus, Trash2, Edit3, FolderPlus, Zap, Folder, GripVertical } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Switch } from '@/components/ui/Switch';

// ================== الأقسام النظامية الثابتة ==================
const SYSTEM_MODULE_GROUPS: Record<string, { label: string; icon: string; modules: { key: string; label: string; isSystem: boolean }[] }> = {
  financial: {
    label: 'الوحدات المالية',
    icon: '💰',
    modules: [
      { key: 'invoices', label: 'الفواتير', isSystem: true },
      { key: 'vouchers', label: 'السندات', isSystem: true },
      { key: 'receipts', label: 'سندات القبض', isSystem: true },
      { key: 'disbursements', label: 'سندات الصرف', isSystem: true },
      { key: 'journal', label: 'القيود المحاسبية', isSystem: true },
      { key: 'cash', label: 'الخزينة', isSystem: true },
      { key: 'banks', label: 'البنوك', isSystem: true },
    ],
  },
  accounts: {
    label: 'الحسابات والأطراف',
    icon: '📊',
    modules: [
      { key: 'accounts', label: 'شجرة الحسابات', isSystem: true },
      { key: 'clients', label: 'العملاء', isSystem: true },
      { key: 'contacts', label: 'جهات الاتصال', isSystem: true },
      { key: 'employees', label: 'الموظفين', isSystem: true },
      { key: 'subcontractors', label: 'مقاولي الباطن', isSystem: true },
    ],
  },
  projects: {
    label: 'المشاريع',
    icon: '🏗️',
    modules: [
      { key: 'projects', label: 'المشاريع', isSystem: true },
      { key: 'boq', label: 'جدول الكميات', isSystem: true },
      { key: 'progress_billing', label: 'فوترة تقدم', isSystem: true },
    ],
  },
  purchases: {
    label: 'المشتريات',
    icon: '🛒',
    modules: [
      { key: 'purchase_orders', label: 'أوامر الشراء', isSystem: true },
      { key: 'purchase_invoices', label: 'فواتير الشراء', isSystem: true },
    ],
  },
  inventory: {
    label: 'المخزون',
    icon: '📦',
    modules: [
      { key: 'inventory', label: 'المخزون', isSystem: true },
      { key: 'warehouses', label: 'المستودعات', isSystem: true },
      { key: 'inventory_transactions', label: 'حركات المخزون', isSystem: true },
    ],
  },
  assets: {
    label: 'الأصول والعهدة',
    icon: '🏢',
    modules: [
      { key: 'fixed_assets', label: 'الأصول الثابتة', isSystem: true },
      { key: 'custodies', label: 'العهدة', isSystem: true },
    ],
  },
  payroll: {
    label: 'الرواتب',
    icon: '💼',
    modules: [
      { key: 'payroll', label: 'الرواتب', isSystem: true },
      { key: 'salary_sheets', label: 'كشف الرواتب', isSystem: true },
      { key: 'employee_advances', label: 'سلف الموظفين', isSystem: true },
    ],
  },
  admin: {
    label: 'الإدارة',
    icon: '⚙️',
    modules: [
      { key: 'users', label: 'المستخدمين', isSystem: true },
      { key: 'settings', label: 'الإعدادات', isSystem: true },
      { key: 'reports', label: 'التقارير', isSystem: true },
      { key: 'subscription', label: 'الاشتراك', isSystem: true },
    ],
  },
};

// العمليات النظامية الثابتة
const SYSTEM_ACTIONS = [
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

// أنواع الأقسام المخصصة
interface CustomModule {
  id: string;
  name: string;
  name_en?: string;
  icon: string;
  group_name: string;
  is_system: boolean;
}

// أنواع العمليات المخصصة
interface CustomAction {
  id: string;
  name: string;
  name_en?: string;
  icon: string;
  code: string;
  is_system: boolean;
}

export default function PermissionsPage() {
  const router = useRouter(); // FIXED: Declared router hook inside component
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // FIXED: حماية الصفحة برمجياً على مستوى المكون لضمان ترحيل وإيقاف أي حساب إضافي يحاول فتح رابط الصلاحيات مباشرة من شريط العنوان بالمتصفح
  const { user: loggedInUser, isLoading: authLoading } = useAuthStore();
  
  useEffect(() => {
    if (!authLoading && loggedInUser && loggedInUser.role !== 'admin') {
      router.push('/dashboard');
    }
  }, [loggedInUser, authLoading, router]);
  
  // حالة النافذة المنبثقة للصلاحيات
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [bypassTelegram, setBypassTelegram] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  
  // الأقسام والعمليات المخصصة
  const [customModules, setCustomModules] = useState<CustomModule[]>([]);
  const [customActions, setCustomActions] = useState<CustomAction[]>([]);
  
  // نوافذ إضافة قسم/عملية
  const [showAddModule, setShowAddModule] = useState(false);
  const [showAddAction, setShowAddAction] = useState(false);
  const [newModule, setNewModule] = useState({ name: '', icon: '📁', group_name: 'custom' });
  const [newAction, setNewAction] = useState({ name: '', code: '', icon: '⚡' });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  // إدارة الأدوار
  const [showManageSection, setShowManageSection] = useState(false);
  const [manageTab, setManageTab] = useState<'modules' | 'actions'>('modules');

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError('');
      
      const [usersRes, modulesRes, actionsRes] = await Promise.all([
        fetch('/api/permissions'),
        fetch('/api/permissions/modules'),
        fetch('/api/permissions/actions'),
      ]);
      
      const [usersJson, modulesJson, actionsJson] = await Promise.all([
        usersRes.json(),
        modulesRes.json(),
        actionsRes.json(),
      ]);
      
      if (usersJson.success) setUsers(usersJson.data?.users || []);
      if (modulesJson.success) setCustomModules(modulesJson.data?.modules || []);
      if (actionsJson.success) setCustomActions(actionsJson.data?.actions || []);
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // ========== بناء قائمة الأقسام الكاملة (نظامية + مخصصة) ==========
  const getAllModules = () => {
    const allGroups = { ...SYSTEM_MODULE_GROUPS };
    
    // إضافة الأقسام المخصصة في مجموعة "custom"
    if (customModules.length > 0) {
      allGroups['custom'] = {
        label: 'أقسام مخصصة',
        icon: '🔧',
        modules: customModules.map(m => ({ key: m.name, label: `${m.icon} ${m.name}`, isSystem: false })),
      };
    }
    
    return allGroups;
  };

  // ========== بناء قائمة العمليات الكاملة (نظامية + مخصصة) ==========
  const getAllActions = () => {
    const allActions = [...SYSTEM_ACTIONS];
    
    for (const ca of customActions) {
      allActions.push({
        key: ca.code,
        label: `${ca.icon} ${ca.name}`,
        icon: ca.icon,
        color: 'bg-orange-100 text-orange-700',
      });
    }
    
    return allActions;
  };

  // ========== فتح نافذة الصلاحيات ==========
  const openPermissionsModal = async (user: any) => {
    setSelectedUser(user);
    setSaveMessage('');
    
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
    
    const expanded: Record<string, boolean> = {};
    Object.keys(getAllModules()).forEach(k => expanded[k] = true);
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
    const allMods = getAllModules();
    Object.values(allMods).forEach(group => {
      group.modules.forEach(mod => {
        newPerms[mod.key] = [...defaults];
      });
    });
    setPermissions(newPerms);
  };

  const handleSave = async () => {
    if (!selectedUser) return;
    setSaving(true);
    setSaveMessage('');

    try {
      const allMods = getAllModules();
      const allModuleKeys = Object.values(allMods).flatMap(g => g.modules.map(m => m.key));
      
      for (const module of allModuleKeys) {
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
      fetchAll();
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

  // ========== إضافة قسم جديد ==========
  const handleAddModule = async () => {
    if (!newModule.name.trim()) {
      setAddError('اسم القسم مطلوب');
      return;
    }
    setAddLoading(true);
    setAddError('');
    
    try {
      const res = await fetch('/api/permissions/modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newModule),
      });
      const json = await res.json();
      
      if (json.success) {
        setCustomModules(prev => [...prev, json.data]);
        setNewModule({ name: '', icon: '📁', group_name: 'custom' });
        setShowAddModule(false);
      } else {
        setAddError(json.message || 'فشل إضافة القسم');
      }
    } catch {
      setAddError('فشل الاتصال بالخادم');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteModule = async (mod: CustomModule) => {
    if (mod.is_system) return;
    if (!confirm(`هل تريد حذف قسم "${mod.name}"؟ سيتم إزالة صلاحيات هذا القسم من جميع المستخدمين.`)) return;
    
    try {
      const res = await fetch(`/api/permissions/modules?id=${mod.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setCustomModules(prev => prev.filter(m => m.id !== mod.id));
      }
    } catch {}
  };

  // ========== إضافة عملية جديدة ==========
  const handleAddAction = async () => {
    if (!newAction.name.trim()) {
      setAddError('اسم العملية مطلوب');
      return;
    }
    if (!newAction.code.trim()) {
      setAddError('كود العملية مطلوب');
      return;
    }
    setAddLoading(true);
    setAddError('');
    
    try {
      const res = await fetch('/api/permissions/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAction),
      });
      const json = await res.json();
      
      if (json.success) {
        setCustomActions(prev => [...prev, json.data]);
        setNewAction({ name: '', code: '', icon: '⚡' });
        setShowAddAction(false);
      } else {
        setAddError(json.message || 'فشل إضافة العملية');
      }
    } catch {
      setAddError('فشل الاتصال بالخادم');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteAction = async (action: CustomAction) => {
    if (action.is_system) return;
    if (!confirm(`هل تريد حذف عملية "${action.name}"؟`)) return;
    
    try {
      const res = await fetch(`/api/permissions/actions?id=${action.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setCustomActions(prev => prev.filter(a => a.id !== action.id));
      }
    } catch {}
  };

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="الصلاحيات" description="إدارة صلاحيات المستخدمين" />
        <LoadingSkeleton variant="table" count={5} />
      </div>
    );
  }

  const allModules = getAllModules();
  const allActions = getAllActions();

  return (
    <div className="p-6 space-y-6">
      <PageHeader 
        title="إدارة الصلاحيات" 
        description="التحكم في صلاحيات المستخدمين والأقسام والعمليات"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowManageSection(true)}>
              <Settings size={16} className="ml-1" />
              إدارة الأقسام والعمليات
            </Button>
            <Badge variant="info">{users.length} مستخدم</Badge>
          </div>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 flex items-center gap-2">
          <AlertCircle size={20} /> {error}
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

      {/* إحصائيات سريعة */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <Folder size={20} className="text-blue-600" />
          </div>
          <div>
            <div className="text-lg font-bold">{Object.values(allModules).reduce((sum, g) => sum + g.modules.length, 0)}</div>
            <div className="text-sm text-gray-500">قسم/وحدة</div>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
            <Zap size={20} className="text-purple-600" />
          </div>
          <div>
            <div className="text-lg font-bold">{allActions.length}</div>
            <div className="text-sm text-gray-500">عملية/صلاحية</div>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
            <ShieldCheck size={20} className="text-green-600" />
          </div>
          <div>
            <div className="text-lg font-bold">{customModules.length + customActions.length}</div>
            <div className="text-sm text-gray-500">عنصر مخصص</div>
          </div>
        </Card>
      </div>

      {/* قائمة المستخدمين */}
      <Card className="overflow-hidden" padding="none">
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
                      مخصص
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

      {/* ===================== نافذة إدارة الأقسام والعمليات ===================== */}
      <Modal
        isOpen={showManageSection}
        onClose={() => setShowManageSection(false)}
        title="إدارة الأقسام والعمليات"
        size="xl"
      >
        <div className="space-y-4">
          {/* التبويبات */}
          <div className="flex gap-2 border-b pb-2">
            <button
              onClick={() => setManageTab('modules')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                manageTab === 'modules' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Folder size={16} /> الأقسام ({customModules.length} مخصص)
            </button>
            <button
              onClick={() => setManageTab('actions')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                manageTab === 'actions' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Zap size={16} /> العمليات ({customActions.length} مخصص)
            </button>
          </div>

          {addError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm flex items-center gap-2">
              <AlertCircle size={16} /> {addError}
            </div>
          )}

          {manageTab === 'modules' && (
            <div className="space-y-4">
              {/* زر إضافة قسم */}
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  الأقسام النظامية ({Object.values(SYSTEM_MODULE_GROUPS).reduce((s, g) => s + g.modules.length, 0)}) لا يمكن حذفها
                </p>
                <Button size="sm" onClick={() => { setShowAddModule(true); setAddError(''); }}>
                  <FolderPlus size={16} className="ml-1" />
                  إضافة قسم
                </Button>
              </div>

              {/* قائمة الأقسام المخصصة */}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {customModules.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <Folder size={40} className="mx-auto mb-2" />
                    <p>لا توجد أقسام مخصصة</p>
                    <p className="text-xs mt-1">أضف أقساماً مخصصة تناسب طبيعة عملك</p>
                  </div>
                ) : (
                  customModules.map(mod => (
                    <div key={mod.id} className="flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded-lg">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{mod.icon}</span>
                        <div>
                          <div className="font-medium">{mod.name}</div>
                          <div className="text-xs text-gray-500">الكود: {mod.name} | المجموعة: {mod.group_name}</div>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteModule(mod)} className="text-red-500 hover:bg-red-100">
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {manageTab === 'actions' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  العمليات النظامية ({SYSTEM_ACTIONS.length}) لا يمكن حذفها
                </p>
                <Button size="sm" onClick={() => { setShowAddAction(true); setAddError(''); }}>
                  <Plus size={16} className="ml-1" />
                  إضافة عملية
                </Button>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {customActions.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <Zap size={40} className="mx-auto mb-2" />
                    <p>لا توجد عمليات مخصصة</p>
                    <p className="text-xs mt-1">أضف عمليات مثل: موافقة استرداد، اعتماد تحويل...</p>
                  </div>
                ) : (
                  customActions.map(action => (
                    <div key={action.id} className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{action.icon}</span>
                        <div>
                          <div className="font-medium">{action.name}</div>
                          <div className="text-xs text-gray-500">الكود: <code className="bg-gray-100 px-1 rounded">{action.code}</code></div>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteAction(action)} className="text-red-500 hover:bg-red-100">
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ===================== نافذة إضافة قسم ===================== */}
      <Modal
        isOpen={showAddModule}
        onClose={() => setShowAddModule(false)}
        title="إضافة قسم جديد"
        size="md"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowAddModule(false)}>إلغاء</Button>
            <Button onClick={handleAddModule} disabled={addLoading}>
              {addLoading ? 'جاري الإضافة...' : 'إضافة'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {addError && <div className="bg-red-50 border border-red-200 rounded p-2 text-red-600 text-sm">{addError}</div>}
          <Input label="اسم القسم *" value={newModule.name} onChange={(e) => setNewModule(p => ({...p, name: e.target.value}))} placeholder="مثال: العقود، التأمين، الجودة..." />
          <div className="grid grid-cols-2 gap-4">
            <Input label="الأيقونة (إيموجي)" value={newModule.icon} onChange={(e) => setNewModule(p => ({...p, icon: e.target.value}))} placeholder="📁" />
            <Input label="المجموعة" value={newModule.group_name} onChange={(e) => setNewModule(p => ({...p, group_name: e.target.value}))} placeholder="custom" />
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
            💡 بعد إضافة القسم، سيظهر في صفحة الصلاحيات ويمكن تعيينه للمستخدمين
          </div>
        </div>
      </Modal>

      {/* ===================== نافذة إضافة عملية ===================== */}
      <Modal
        isOpen={showAddAction}
        onClose={() => setShowAddAction(false)}
        title="إضافة عملية/صلاحية جديدة"
        size="md"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowAddAction(false)}>إلغاء</Button>
            <Button onClick={handleAddAction} disabled={addLoading}>
              {addLoading ? 'جاري الإضافة...' : 'إضافة'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {addError && <div className="bg-red-50 border border-red-200 rounded p-2 text-red-600 text-sm">{addError}</div>}
          <Input label="اسم العملية *" value={newAction.name} onChange={(e) => setNewAction(p => ({...p, name: e.target.value}))} placeholder="مثال: موافقة استرداد، اعتماد نقل..." />
          <div className="grid grid-cols-2 gap-4">
            <Input label="الكود (إنجليزي) *" value={newAction.code} onChange={(e) => setNewAction(p => ({...p, code: e.target.value}))} placeholder="مثال: approve_refund" />
            <Input label="الأيقونة (إيموجي)" value={newAction.icon} onChange={(e) => setNewAction(p => ({...p, icon: e.target.value}))} placeholder="⚡" />
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
            💡 <strong>الكود</strong> يجب أن يكون فريد وبالإنجليزية (مثل: approve_refund, transfer_assets). سيظهر كزر صلاحية يمكن تفعيله لكل قسم.
          </div>
        </div>
      </Modal>

      {/* ===================== نافذة صلاحيات المستخدم ===================== */}
      <Modal 
        isOpen={showPermissionsModal} 
        onClose={() => setShowPermissionsModal(false)} 
        title={`صلاحيات: ${selectedUser?.name || ''}`} 
        size="xl"
        footer={
          <div className="flex justify-between items-center w-full">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={resetToDefaults}>
                استعادة الافتراضي
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
                  <div className="text-sm text-amber-600">عند التفعيل، لن يحتاج هذا المستخدم لتأكيد التيليجرام عند المعاملات الكبيرة</div>
                </div>
              </div>
              <Switch checked={bypassTelegram} onChange={(v) => setBypassTelegram(v)} />
            </div>
          </Card>

          {/* معلومات الدور */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-sm text-blue-700">
              <strong>الدور:</strong> {ROLE_LABELS[selectedUser?.role]?.label || selectedUser?.role}
              <span className="mx-2">|</span>
              <strong>الافتراضي:</strong>
              {ROLE_DEFAULTS[selectedUser?.role]?.map(action => {
                const actionInfo = allActions.find(a => a.key === action);
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
            {Object.entries(allModules).map(([groupKey, group]) => (
              <div key={groupKey} className={`border rounded-lg overflow-hidden ${groupKey === 'custom' ? 'border-orange-300 bg-orange-50/30' : ''}`}>
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className="font-medium flex items-center gap-2">
                    <span>{group.icon}</span>
                    {group.label}
                    {groupKey === 'custom' && <Badge variant="warning" className="text-xs">مخصص</Badge>}
                    <span className="text-xs text-gray-400">({group.modules.length})</span>
                  </span>
                  {expandedGroups[groupKey] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>

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
                              {isCustom && <Badge variant="warning" className="text-xs">مخصص</Badge>}
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => setAllForModule(mod.key, allActions.map(a => a.key))}
                                className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100"
                              >الكل</button>
                              <button
                                onClick={() => setAllForModule(mod.key, [])}
                                className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100"
                              >لا شيء</button>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-2">
                            {allActions.map(action => {
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
