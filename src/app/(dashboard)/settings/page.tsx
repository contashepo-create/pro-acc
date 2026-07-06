'use client';

import { useState } from 'react';
import { Save, Palette, Sun, Moon, Check } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Toast } from '@/components/ui/Toast';
import { useThemeStore } from '@/store/theme-store';
import { themes } from '@/lib/themes';

export default function SettingsPage() {
  const [tab, setTab] = useState('general');
  const [toast, setToast] = useState('');
  const { themeId, isDark, setTheme, toggleMode, setDark } = useThemeStore();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const currentTheme = themes.find((t) => t.id === themeId) || themes[0];

  return (
    <div className="space-y-6">
      <PageHeader title="الإعدادات" description="إعدادات الشركة والنظام" />

      <Tabs items={[
        { id: 'general', label: 'عام' },
        { id: 'accounting', label: 'محاسبة' },
        { id: 'tax', label: 'ضرائب' },
        { id: 'appearance', label: 'المظهر' },
        { id: 'notifications', label: 'إشعارات' },
      ]} activeTab={tab} onChange={setTab} />

      {tab === 'general' && (
        <Card title="معلومات الشركة">
          <div className="grid grid-cols-2 gap-4">
            <Input label="اسم الشركة" defaultValue="شركتي" className="col-span-2" />
            <Input label="رقم السجل التجاري" />
            <Input label="الرقم الضريبي" />
            <Input label="الهاتف" />
            <Input label="البريد الإلكتروني" type="email" />
            <Input label="العنوان" className="col-span-2" />
            <Input label="رمز العملة" defaultValue="SAR" />
          </div>
          <div className="mt-4">
            <Button onClick={() => showToast('تم حفظ الإعدادات')} leftIcon={<Save size={16} />}>حفظ الإعدادات</Button>
          </div>
        </Card>
      )}

      {tab === 'accounting' && (
        <Card title="الإعدادات المحاسبية">
          <div className="grid grid-cols-2 gap-4">
            <Input label="بداية السنة المالية" type="date" />
            <Input label="عدد المنازل العشرية" type="number" defaultValue="2" />
          </div>
        </Card>
      )}

      {tab === 'tax' && (
        <Card title="إعدادات الضرائب">
          <div className="grid grid-cols-2 gap-4">
            <Input label="نسبة ضريبة القيمة المضافة (%)" type="number" defaultValue="15" />
          </div>
        </Card>
      )}

      {tab === 'appearance' && (
        <div className="space-y-6">
          {/* Mode toggle */}
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">الوضع</h3>
                <p className="text-sm text-text-muted mt-0.5">
                  {isDark ? 'وضع داكن — ألوان عميقة مريحة للعين' : 'وضع فاتح — ألوان نقية مناسبة للإضاءة القوية'}
                </p>
              </div>
              <button
                onClick={toggleMode}
                className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${
                  isDark ? 'bg-accent/30' : 'bg-border'
                }`}
              >
                <div
                  className={`absolute top-1 w-6 h-6 rounded-full bg-accent flex items-center justify-center transition-all duration-300 shadow-md ${
                    isDark ? 'right-1' : 'right-9'
                  }`}
                >
                  {isDark ? <Moon size={12} className="text-white" /> : <Sun size={12} className="text-white" />}
                </div>
              </button>
            </div>
          </Card>

          {/* Theme selection */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Palette size={18} className="text-accent" />
              <h3 className="text-base font-semibold">الثيم</h3>
            </div>
            <p className="text-sm text-text-muted mb-4">
              اختر لوحة الألوان الأساسية. زر الوضع (داكن/فاتح) في الأعلى يحوّل بين النسختين الداكنة والفاتحة من الثيم المحدد.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {themes.map((theme) => {
                const isActive = theme.id === themeId;
                const previewBg = isDark ? theme.dark['--color-bg-primary'] : theme.light['--color-bg-primary'];
                const previewAccent = isDark ? theme.dark['--color-accent'] : theme.light['--color-accent'];
                const previewCard = isDark ? theme.dark['--color-bg-card'] : theme.light['--color-bg-card'];
                const previewBorder = isDark ? theme.dark['--color-border'] : theme.light['--color-border'];

                return (
                  <button
                    key={theme.id}
                    onClick={() => setTheme(theme.id)}
                    className={`relative p-3 rounded-xl border-2 text-right transition-all duration-200 hover:-translate-y-0.5 ${
                      isActive
                        ? 'border-accent shadow-md'
                        : 'border-border hover:border-border-light'
                    }`}
                    style={{ background: previewCard }}
                  >
                    {isActive && (
                      <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                    <div className="flex gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg" style={{ background: previewAccent }} />
                      <div>
                        <div className="text-sm font-semibold text-text-primary">{theme.name}</div>
                        <div className="text-[11px] text-text-muted">{theme.nameEn}</div>
                      </div>
                    </div>
                    <p className="text-xs text-text-muted leading-relaxed mb-2">{theme.description}</p>
                    <div
                      className="h-8 rounded-lg flex gap-1 p-1"
                      style={{ background: previewBg, border: `1px solid ${previewBorder}` }}
                    >
                      <div className="flex-1 rounded" style={{ background: previewCard }} />
                      <div className="w-6 rounded" style={{ background: previewAccent }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Current theme info */}
          <Card padding="md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: isDark ? currentTheme.dark['--color-accent'] : currentTheme.light['--color-accent'] }}>
                <Palette size={18} className="text-white" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-primary">
                  الثيم الحالي: {currentTheme.name}
                </div>
                <div className="text-xs text-text-muted">
                  {isDark ? 'وضع داكن' : 'وضع فاتح'} — {currentTheme.nameEn}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'notifications' && (
        <Card title="الإشعارات">
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" defaultChecked />
              <span className="text-sm">إشعار عند إضافة فاتورة جديدة</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" defaultChecked />
              <span className="text-sm">إشعار عند استحقاق فاتورة</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" defaultChecked />
              <span className="text-sm">إشعار عند انخفاض رصيد المخزون</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" />
              <span className="text-sm">إشعار عند إنشاء سند قبض/صرف</span>
            </label>
          </div>
          <div className="mt-4">
            <Button onClick={() => showToast('تم حفظ الإعدادات')} leftIcon={<Save size={16} />}>حفظ</Button>
          </div>
        </Card>
      )}

      {toast && (
        <div className="toast toast-success">
          <span>{toast}</span>
          <button onClick={() => setToast('')} className="btn-ghost btn-sm">✕</button>
        </div>
      )}
    </div>
  );
}
