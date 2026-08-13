'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User, Mail, Shield, Save } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore } from '@/store/auth-store';

const ROLE_LABELS: Record<string, string> = {
  admin: 'مدير النظام',
  manager: 'مدير',
  accountant: 'محاسب',
  supervisor: 'مراقب',
};

const MIN_PASSWORD_LENGTH = 8;

export default function ProfilePage() {
  const router = useRouter();
  const { user, setUser, logout } = useAuthStore();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (user?.name) setName(user.name);
    if (user?.email) setEmail(user.email);
  }, [user?.name, user?.email]);

  const handleSaveProfile = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        // خادم الـ API يعيد المستخدم المحدّث عند الحفظ الناجح
        const updatedUser = json.user;
        if (updatedUser && user) {
          setUser({ ...user, name: updatedUser.name, email: updatedUser.email });
        }
        setMessage('✅ تم حفظ البيانات بنجاح');
      } else {
        setMessage('❌ ' + (json.message || 'فشل الحفظ'));
      }
    } catch {
      setMessage('❌ فشل الاتصال');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordMsg('');
    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordMsg('❌ يرجى ملء جميع الحقول');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg('❌ كلمة المرور الجديدة غير متطابقة');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordMsg(`❌ كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
      return;
    }
    if (newPassword === oldPassword) {
      setPasswordMsg('❌ كلمة المرور الجديدة يجب أن تختلف عن الحالية');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setPasswordMsg('✅ تم تغيير كلمة المرور بنجاح — جاري تسجيل الخروج لإعادة الدخول بكلمة المرور الجديدة...');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        // إبطال الجلسة الحالية إجبارياً لأن السيرفر رفع token_version
        setTimeout(async () => {
          await logout();
          router.replace('/login');
        }, 1200);
      } else {
        setPasswordMsg('❌ ' + (json.message || 'فشل تغيير كلمة المرور'));
      }
    } catch {
      setPasswordMsg('❌ فشل الاتصال');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="الملف الشخصي" description="عرض وتعديل بيانات حسابك" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* بطاقة المعلومات */}
        <Card className="md:col-span-1 text-center p-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4">
            {user?.name?.charAt(0) || '?'}
          </div>
          <h3 className="text-xl font-bold text-gray-800">{user?.name || 'المستخدم'}</h3>
          <p className="text-gray-500 text-sm">{user?.email || ''}</p>
          <Badge className={`mt-3 ${user?.role === 'admin' ? 'bg-red-100 text-red-700 border-red-200' : user?.role === 'manager' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-green-100 text-green-700 border-green-200'} border`}>
            <Shield size={14} className="ml-1" />
            {ROLE_LABELS[user?.role || ''] || user?.role}
          </Badge>
        </Card>

        {/* تعديل البيانات */}
        <Card className="md:col-span-2 p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <User size={20} /> البيانات الشخصية
          </h3>
          
          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${message.includes('✅') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {message}
            </div>
          )}

          <div className="space-y-4">
            <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="البريد الإلكتروني" value={email} disabled />
            
            <Button onClick={handleSaveProfile} disabled={saving}>
              <Save size={16} className="ml-1" />
              {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </Button>
          </div>
        </Card>
      </div>

      {/* تغيير كلمة المرور */}
      <Card className="p-6">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Shield size={20} /> تغيير كلمة المرور
        </h3>
        
        {passwordMsg && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${passwordMsg.includes('✅') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {passwordMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input label="كلمة المرور الحالية" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" />
          <Input label={`كلمة المرور الجديدة (${MIN_PASSWORD_LENGTH} أحرف على الأقل)`} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          <Input label="تأكيد كلمة المرور" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        </div>
        
        <Button onClick={handleChangePassword} className="mt-4" variant="outline" disabled={changingPassword}>
          {changingPassword ? 'جاري التغيير...' : 'تغيير كلمة المرور'}
        </Button>
      </Card>
    </div>
  );
}
