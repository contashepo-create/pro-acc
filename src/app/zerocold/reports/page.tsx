'use client';

import { useState, useEffect } from 'react';
import { 
  BarChart3, TrendingUp, Users, Eye, 
  MousePointer2, Calendar, Download, Filter,
  CheckCircle, XCircle, Clock, Bell
} from 'lucide-react';

interface AdReport {
  id: string;
  title: string;
  type: string;
  display_mode: string;
  views: number;
  clicks: number;
  notifications_sent: number;
  ctr: number;
  unique_users: number;
  unique_companies: number;
  created_at: string;
}

interface ApprovalReport {
  id: string;
  transaction_type: string;
  amount: number;
  requester_name: string;
  status: string;
  created_at: string;
  approved_at?: string;
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<'ads' | 'approvals'>('ads');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const [adData, setAdData] = useState<AdReport[]>([]);
  const [approvalData, setApprovalData] = useState<ApprovalReport[]>([]);
  
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    loadData();
  }, [activeTab, dateRange]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      
      if (activeTab === 'ads') {
        const res = await fetch(`/api/admin/reports?type=ads&start=${dateRange.start}&end=${dateRange.end}`);
        const data = await res.json();
        if (data.success) {
          setAdData(data.data || []);
        } else {
          setError(data.message || 'فشل تحميل بيانات الإعلانات');
        }
      } else {
        const res = await fetch(`/api/admin/reports?type=approvals&start=${dateRange.start}&end=${dateRange.end}`);
        const data = await res.json();
        if (data.success) {
          setApprovalData(data.data || []);
        } else {
          setError(data.message || 'فشل تحميل بيانات الاعتمادات');
        }
      }
    } catch (err) {
      console.error('Failed to load report data:', err);
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const data = activeTab === 'ads' ? adData : approvalData;
      const csv = generateCSV(data, activeTab);
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${activeTab}_report_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      
      setShowExport(false);
    } catch (err) {
      console.error('Failed to export data:', err);
    }
  };

  const generateCSV = (data: any[], type: string): string => {
    if (type === 'ads') {
      const headers = ['العنوان', 'النوع', 'طريقة العرض', 'المشاهدات', 'النقرات', 'الإشعارات', 'المستخدمين الفريدين', 'الشركات الفريدة', 'معدل النقر', 'تاريخ الإنشاء'];
      const rows = data.map(ad => [
        ad.title,
        ad.type,
        ad.display_mode,
        ad.views,
        ad.clicks,
        ad.notifications_sent,
        ad.unique_users,
        ad.unique_companies,
        ad.ctr.toFixed(2) + '%',
        new Date(ad.created_at).toLocaleDateString('ar-SA'),
      ]);
      return [headers, ...rows].map(row => row.join(',')).join('\n');
    } else {
      const headers = ['نوع المعاملة', 'المبلغ', 'صاحب الطلب', 'الحالة', 'تاريخ الطلب', 'تاريخ الاعتماد'];
      const rows = data.map(app => [
        app.transaction_type,
        app.amount.toFixed(2),
        app.requester_name,
        app.status,
        new Date(app.created_at).toLocaleDateString('ar-SA'),
        app.approved_at ? new Date(app.approved_at).toLocaleDateString('ar-SA') : '-',
      ]);
      return [headers, ...rows].map(row => row.join(',')).join('\n');
    }
  };

  const calculateCTR = (views: number, clicks: number) => {
    if (views === 0) return 0;
    return ((clicks / views) * 100).toFixed(1);
  };

  const calculateStats = (data: any[], type: string) => {
    if (data.length === 0) return null;

    if (type === 'ads') {
      const totalViews = data.reduce((sum, ad) => sum + ad.views, 0);
      const totalClicks = data.reduce((sum, ad) => sum + ad.clicks, 0);
      const totalNotifications = data.reduce((sum, ad) => sum + ad.notifications_sent, 0);
      const uniqueUsers = new Set(data.flatMap(ad => []));
      const uniqueCompanies = new Set(data.flatMap(ad => []));
      
      return {
        totalViews,
        totalClicks,
        totalNotifications,
        avgCTR: calculateCTR(totalViews, totalClicks),
        totalAds: data.length,
        activeAds: data.filter(ad => ad.status === 'active').length,
      };
    } else {
      const totalAmount = data.reduce((sum, app) => sum + app.amount, 0);
      const approvedAmount = data
        .filter(app => app.status === 'approved')
        .reduce((sum, app) => sum + app.amount, 0);
      const rejectedAmount = data
        .filter(app => app.status === 'rejected')
        .reduce((sum, app) => sum + app.amount, 0);
      const pendingAmount = data
        .filter(app => app.status === 'pending')
        .reduce((sum, app) => sum + app.amount, 0);

      return {
        totalRequests: data.length,
        totalAmount,
        approvedAmount,
        rejectedAmount,
        pendingAmount,
        approvalRate: data.length > 0 ? ((data.filter(a => a.status === 'approved').length / data.length) * 100).toFixed(1) : '0',
        rejectionRate: data.length > 0 ? ((data.filter(a => a.status === 'rejected').length / data.length) * 100).toFixed(1) : '0',
      };
    }
  };

  const adStats = calculateStats(adData, 'ads');
  const approvalStats = calculateStats(approvalData, 'approvals');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto"></div>
        <p className="mt-4 text-text-muted">جاري تحميل البيانات...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
            <BarChart3 size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">التقارير والإحصائيات</h1>
            <p className="text-xs text-text-muted">تتبع أداء الإعلانات والاعتمادات</p>
          </div>
        </div>
        <button onClick={() => setShowExport(true)} className="btn btn-primary text-sm gap-2">
          <Download size={16} /> تصدير البيانات
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('ads')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'ads'
              ? 'bg-accent text-white'
              : 'bg-gray-100 text-text-muted hover:bg-gray-200'
          }`}
        >
          <Eye size={16} className="inline mr-2" />
          تقارير الإعلانات
        </button>
        <button
          onClick={() => setActiveTab('approvals')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'approvals'
              ? 'bg-accent text-white'
              : 'bg-gray-100 text-text-muted hover:bg-gray-200'
          }`}
        >
          <CheckCircle size={16} className="inline mr-2" />
          تقارير الاعتمادات
        </button>
      </div>

      {/* Date Filter */}
      <div className="glass rounded-lg p-4">
        <div className="flex items-center gap-4">
          <Calendar size={20} className="text-text-muted" />
          <div className="flex-1 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">من تاريخ</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                className="input-base"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">إلى تاريخ</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                className="input-base"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Statistics Cards */}
      {activeTab === 'ads' && adStats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass rounded-lg p-4">
            <div className="flex items-center gap-2 text-blue-600 mb-2">
              <Eye size={18} />
              <span className="text-sm font-medium">إجمالي المشاهدات</span>
            </div>
            <div className="text-2xl font-bold text-blue-700">{adStats.totalViews.toLocaleString()}</div>
          </div>
          <div className="glass rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-600 mb-2">
              <MousePointer2 size={18} />
              <span className="text-sm font-medium">إجمالي النقرات</span>
            </div>
            <div className="text-2xl font-bold text-green-700">{adStats.totalClicks.toLocaleString()}</div>
          </div>
          <div className="glass rounded-lg p-4">
            <div className="flex items-center gap-2 text-purple-600 mb-2">
              <Bell size={18} />
              <span className="text-sm font-medium">إجمالي الإشعارات</span>
            </div>
            <div className="text-2xl font-bold text-purple-700">{adStats.totalNotifications.toLocaleString()}</div>
          </div>
          <div className="glass rounded-lg p-4">
            <div className="flex items-center gap-2 text-accent mb-2">
              <TrendingUp size={18} />
              <span className="text-sm font-medium">معدل النقر</span>
            </div>
            <div className="text-2xl font-bold text-accent">{adStats.avgCTR}%</div>
          </div>
        </div>
      ) : approvalStats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass rounded-lg p-4">
            <div className="flex items-center gap-2 text-blue-600 mb-2">
              <Bell size={18} />
              <span className="text font-medium">إجمالي الطلبات</span>
            </div>
            <div className="text-2xl font-bold text-blue-700">{approvalStats.totalRequests}</div>
          </div>
          <div className="glass rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-600 mb-2">
              <CheckCircle size={18} />
              <span className="text-sm font-medium">المبلغ المعتمد</span>
            </div>
            <div className="text-2xl font-bold text-green-700">{approvalStats.approvedAmount.toLocaleString()} ر.س</div>
          </div>
          <div className="glass rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-600 mb-2">
              <XCircle size={18} />
              <span className="text-sm font-medium">المبلغ المرفوض</span>
            </div>
            <div className="text-2xl font-bold text-red-700">{approvalStats.rejectedAmount.toLocaleString()} ر.س</div>
          </div>
          <div className="glass rounded-lg p-4">
            <div className="flex items-center gap-2 text-accent mb-2">
              <Clock size={18} />
              <span className="text-sm font-medium">قيد الاعتماد</span>
            </div>
            <div className="text-2xl font-bold text-accent">{approvalStats.pendingAmount.toLocaleString()} ر.س</div>
          </div>
        </div>
      ) : null}

      {/* Data Table */}
      <div className="glass rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {activeTab === 'ads' ? (
                <>
                  <th className="px-4 py-3 text-right text-sm font-medium text-text-secondary">العنوان</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">النوع</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">العرض</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">المشاهدات</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">النقرات</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">الإشعارات</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">معدل النقر</th>
                </>
              ) : (
                <>
                  <th className="px-4 py-3 text-right text-sm font-medium text-text-secondary">نوع المعاملة</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">المبلغ</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">صاحب الطلب</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">الحالة</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">تاريخ الطلب</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-text-secondary">تاريخ الاعتماد</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {activeTab === 'ads' ? (
              adData.map((ad) => (
                <tr key={ad.id} className="border-t border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 text-right text-sm">{ad.title}</td>
                  <td className="px-4 py-3 text-center text-sm">{ad.type}</td>
                  <td className="px-4 py-3 text-center text-sm">{ad.display_mode}</td>
                  <td className="px-4 py-3 text-center text-sm">{ad.views.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center text-sm">{ad.clicks.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center text-sm">{ad.notifications_sent.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center text-sm text-accent">{ad.ctr}%</td>
                </tr>
              ))
            ) : (
              approvalData.map((app) => (
                <tr key={app.id} className="border-t border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 text-right text-sm">{app.transaction_type}</td>
                  <td className="px-4 py-3 text-center text-sm">{app.amount.toFixed(2)} ر.س</td>
                  <td className="px-4 py-3 text-center text-sm">{app.requester_name}</td>
                  <td className="px-4 py-3 text-center text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      app.status === 'approved' ? 'bg-green-100 text-green-700' :
                      app.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {app.status === 'approved' ? 'معتمد' : app.status === 'rejected' ? 'مرفوض' : 'قيد الانتظار'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-sm" dir="ltr">
                    {new Date(app.created_at).toLocaleDateString('ar-SA')}
                  </td>
                  <td className="px-4 py-3 text-center text-sm" dir="ltr">
                    {app.approved_at ? new Date(app.approved_at).toLocaleDateString('ar-SA') : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-card rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4">تصدير البيانات</h3>
            <p className="text-sm text-text-muted mb-4">
              سيتم تصديف البيانات بصيغة CSV للفترة المحددة
            </p>
            <div className="flex gap-2">
              <button onClick={handleExport} className="btn btn-primary flex-1">
                تصدير CSV
              </button>
              <button onClick={() => setShowExport(false)} className="btn btn-ghost flex-1">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}