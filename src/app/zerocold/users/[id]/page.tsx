'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  User, Building2, Phone, Mail, Calendar, Shield, 
  Clock, CheckCircle, XCircle, Settings, ArrowRight,
  Users as UsersIcon, Activity, Crown
} from 'lucide-react';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  last_activity: string;
  last_login: string | null;
  created_at: string;
  updated_at: string;
  phone?: string;
  birth_date?: string;
  city?: string;
  company: {
    id: string;
    name: string;
    commercial_registration?: string;
    tax_number?: string;
    phone?: string;
    email?: string;
    address?: string;
    currency_symbol: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  };
  permissions: Array<{
    module: string;
    permissions: string[];
    bypass_telegram_confirmation: boolean;
  }>;
  subscription?: {
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    plan: {
      id: string;
      name: string;
      price_monthly: number;
      max_users: number;
      features: string[];
    };
  };
}

interface Activity {
  action: string;
  details: string;
  created_at: string;
}

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;
  
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadUserData();
  }, [userId]);

  const loadUserData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users?user_id=${userId}`);
      const data = await res.json();
      
      if (data.success) {
        setUser(data.data.user);
        setActivity(data.data.activity || []);
      } else {
        setError(data.message || 'فشل تحميل البيانات');
      }
    } catch (err) {
      setError('خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto"></div>
          <p className="mt-4 text-text-muted">جاري تحميل البيانات...</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error || 'لم يتم العثور على المستخدم'}
        </div>
      </div>
    );
  }

  const roleLabels: Record<string, string> = {
    admin: 'مدير النظام',
    manager: 'مدير',
    accountant: 'محاسب',
    supervisor: 'مشرف',
  };

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 border-green-200',
    inactive: 'bg-gray-100 text-gray-700 border-gray-200',
    cancelled: 'bg-red-100 text-red-700 border-red-200',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => router.back()}
            className="btn btn-ghost btn-icon"
          >
            <ArrowRight size={20} />
          </button>
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold">
            {user.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{user.name}</h1>
            <p className="text-sm text-text-muted">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user.is_active ? (
            <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 border border-green-200 text-sm flex items-center gap-1">
              <CheckCircle size={14} /> نشط
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200 text-sm flex items-center gap-1">
              <XCircle size={14} /> غير نشط
            </span>
          )}
          <span className={`px-3 py-1 rounded-full border text-sm ${
            user.email_verified 
              ? 'bg-blue-100 text-blue-700 border-blue-200' 
              : 'bg-orange-100 text-orange-700 border-orange-200'
          }`}>
            {user.email_verified ? '✓ موثق' : 'غير موثق'}
          </span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* معلومات المستخدم الأساسية */}
        <div className="glass rounded-xl p-6 border">
          <div className="flex items-center gap-2 mb-4">
            <User className="text-accent" size={20} />
            <h2 className="font-bold text-text-primary">معلومات الحساب</h2>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">الاسم</span>
              <span className="text-sm font-medium text-text-primary">{user.name}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">البريد الإلكتروني</span>
              <span className="text-sm font-medium text-text-primary" dir="ltr">{user.email}</span>
            </div>
            {user.phone && (
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">رقم الجوال</span>
                <span className="text-sm font-medium text-text-primary" dir="ltr">{user.phone}</span>
              </div>
            )}
            {user.city && (
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">المدينة</span>
                <span className="text-sm font-medium text-text-primary">{user.city}</span>
              </div>
            )}
            {user.birth_date && (
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">تاريخ الميلاد</span>
                <span className="text-sm font-medium text-text-primary">{new Date(user.birth_date).toLocaleDateString('ar-SA')}</span>
              </div>
            )}
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">الدور</span>
              <span className="text-sm font-medium text-primary px-2 py-1 bg-accent/10 rounded">
                {roleLabels[user.role] || user.role}
              </span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">آخر تسجيل دخول</span>
              <span className="text-sm font-medium text-text-primary" dir="ltr">
                {user.last_login ? new Date(user.last_login).toLocaleString('ar-SA') : 'لم يسجل'}
              </span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">تاريخ إنشاء الحساب</span>
              <span className="text-sm font-medium text-text-primary" dir="ltr">
                {new Date(user.created_at).toLocaleString('ar-SA')}
              </span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">آخر تحديث</span>
              <span className="text-sm font-medium text-text-primary" dir="ltr">
                {new Date(user.updated_at).toLocaleString('ar-SA')}
              </span>
            </div>
          </div>
        </div>

        {/* معلومات الشركة */}
        <div className="glass rounded-xl p-6 border">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="text-accent" size={20} />
            <h2 className="font-bold text-text-primary">معلومات الشركة</h2>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">اسم الشركة</span>
              <span className="text-sm font-medium text-text-primary">{user.company.name}</span>
            </div>
            {user.company.commercial_registration && (
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">السجل التجاري</span>
                <span className="text-sm font-medium text-text-primary">{user.company.commercial_registration}</span>
              </div>
            )}
            {user.company.tax_number && (
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">الرقم الضريبي</span>
                <span className="text-sm font-medium text-text-primary">{user.company.tax_number}</span>
              </div>
            )}
            {user.company.phone && (
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">هاتف الشركة</span>
                <span className="text-sm font-medium text-text-primary" dir="ltr">{user.company.phone}</span>
              </div>
            )}
            {user.company.email && (
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">بريد الشركة</span>
                <span className="text-sm font-medium text-text-primary" dir="ltr">{user.company.email}</span>
              </div>
            )}
            {user.company.address && (
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">العنوان</span>
                <span className="text-sm font-medium text-text-primary">{user.company.address}</span>
              </div>
            )}
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">العملة</span>
              <span className="text-sm font-medium text-text-primary">{user.company.currency_symbol}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">حالة الشركة</span>
              <span className={`px-2 py-1 rounded-full text-xs border ${
                user.company.is_active ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'
              }`}>
                {user.company.is_active ? 'نشط' : 'غير نشط'}
              </span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-sm text-text-muted">تاريخ الإنشاء</span>
              <span className="text-sm font-medium text-text-primary" dir="ltr">
                {new Date(user.company.created_at).toLocaleString('ar-SA')}
              </span>
            </div>
          </div>
        </div>

        {/* معلومات الاشتراك */}
        <div className="glass rounded-xl p-6 border">
          <div className="flex items-center gap-2 mb-4">
            <Crown className="text-accent" size={20} />
            <h2 className="font-bold text-text-primary">الاشتراك</h2>
          </div>
          {user.subscription ? (
            <div className="space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">الباقة</span>
                <span className="text-sm font-medium text-primary px-2 py-1 bg-accent/10 rounded">
                  {user.subscription.plan.name}
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">السعر الشهري</span>
                <span className="text-sm font-medium text-text-primary">
                  {user.subscription.plan.price_monthly} ر.س
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">الحد الأقصى للمستخدمين</span>
                <span className="text-sm font-medium text-text-primary">
                  {user.subscription.plan.max_users} مستخدم
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">حالة الاشتراك</span>
                <span className={`px-2 py-1 rounded-full text-xs border ${
                  statusColors[user.subscription.status] || statusColors.active
                }`}>
                  {user.subscription.status === 'active' ? 'نشط' : 
                   user.subscription.status === 'inactive' ? 'غير نشط' : 
                   'ملغي'}
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">تاريخ البدء</span>
                <span className="text-sm font-medium text-text-primary" dir="ltr">
                  {new Date(user.subscription.start_date).toLocaleDateString('ar-SA')}
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-muted">تاريخ الانتهاء</span>
                <span className="text-sm font-medium text-text-primary" dir="ltr">
                  {new Date(user.subscription.end_date).toLocaleDateString('ar-SA')}
                </span>
              </div>
              <div className="pt-3 border-t">
                <p className="text-sm font-medium text-text-primary mb-2">الميزات:</p>
                <ul className="space-y-1">
                  {user.subscription.plan.features.map((feature, idx) => (
                    <li key={idx} className="text-xs text-text-muted flex items-center gap-2">
                      <CheckCircle size={12} className="text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <Crown size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-text-muted">لا يوجد اشتراك نشط</p>
            </div>
          )}
        </div>
      </div>

      {/* الصلاحيات */}
      <div className="glass rounded-xl p-6 border">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="text-accent" size={20} />
          <h2 className="font-bold text-text-primary">الصلاحيات</h2>
        </div>
        {user.permissions && user.permissions.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {user.permissions.map((perm, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-4">
                <div className="font-medium text-text-primary mb-2">{perm.module}</div>
                <div className="flex flex-wrap gap-2">
                  {perm.permissions.map((p, pIdx) => (
                    <span key={pIdx} className="text-xs px-2 py-1 bg-accent/10 text-accent rounded">
                      {p}
                    </span>
                  ))}
                </div>
                {perm.bypass_telegram_confirmation && (
                  <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle size={12} />
                    يتخطى تأكيد التيليجرام
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">لا توجد صلاحيات مخصصة - يستخدم الصلاحيات الافتراضية للدور</p>
        )}
      </div>

      {/* النشاط الأخير */}
      <div className="glass rounded-xl p-6 border">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="text-accent" size={20} />
          <h2 className="font-bold text-text-primary">النشاط الأخير</h2>
        </div>
        {activity.length > 0 ? (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {activity.map((act, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-text-primary">{act.action}</div>
                    <div className="text-sm text-text-muted mt-1">{act.details}</div>
                  </div>
                  <span className="text-xs text-text-muted whitespace-nowrap" dir="ltr">
                    {new Date(act.created_at).toLocaleString('ar-SA')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">لا يوجد نشاط مسجل</p>
        )}
      </div>
    </div>
  );
}