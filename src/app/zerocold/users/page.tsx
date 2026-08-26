'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Search, Loader2, Eye, Building2, ChevronDown, ChevronUp } from 'lucide-react';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  last_login: string | null;
  created_at: string;
  company: {
    id: string;
    name: string;
    is_active: boolean;
  };
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, boolean>>({});

  const loadUsers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.success) setUsers(data.data || []);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const filteredUsers = users.filter(user => {
    const matchesSearch = searchTerm === '' ||
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.company.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' ||
      (filterStatus === 'active' && user.is_active) ||
      (filterStatus === 'inactive' && !user.is_active);
    return matchesSearch && matchesStatus;
  });

  // Group users by company
  const companyGroups: Record<string, { companyName: string; companyId: string; isActive: boolean; users: User[] }> = {};
  filteredUsers.forEach(user => {
    const key = user.company.id;
    if (!companyGroups[key]) {
      companyGroups[key] = {
        companyName: user.company.name,
        companyId: user.company.id,
        isActive: user.company.is_active,
        users: [],
      };
    }
    companyGroups[key].users.push(user);
  });

  const roleLabels: Record<string, string> = {
    admin: 'مدير النظام',
    manager: 'مدير',
    accountant: 'محاسب',
    supervisor: 'مشرف',
  };

  const statusBadge = (active: boolean) => (
    <span className={`px-2 py-0.5 rounded-full text-xs border ${
      active ? 'bg-success-light text-success border-emerald-500/30' : 'bg-bg-primary text-text-muted border-border'
    }`}>{active ? 'نشط' : 'غير نشط'}</span>
  );

  const toggleCompany = (companyId: string) => {
    setExpandedCompanies(prev => ({ ...prev, [companyId]: !prev[companyId] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={40} className="animate-spin text-text-secondary mx-auto mb-4" />
        <p className="text-text-muted">جاري تحميل المستخدمين...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Users size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">المستخدمون</h1>
            <p className="text-xs text-text-muted">{users.length} مستخدم — {Object.keys(companyGroups).length} شركة</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-bg-secondary border border-border rounded-xl p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="بحث بالاسم، البريد، أو الشركة..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-bg-primary border border-border rounded-lg pr-10 pl-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="flex gap-2">
            {(['all', 'active', 'inactive'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === s ? 'bg-accent text-white' : 'bg-bg-primary text-text-secondary hover:bg-bg-hover'
                }`}>
                {s === 'all' ? 'الكل' : s === 'active' ? 'نشط' : 'غير نشط'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Users grouped by company */}
      {Object.keys(companyGroups).length === 0 ? (
        <div className="text-center py-12">
          <Users size={40} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted">لا توجد نتائج</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.values(companyGroups).map(group => {
            const isExpanded = expandedCompanies[group.companyId] !== false; // default expanded
            const adminUser = group.users.find(u => u.role === 'admin') || group.users[0];
            const additionalUsers = group.users.filter(u => u.id !== adminUser.id);

            return (
              <div key={group.companyId} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                {/* Company Header */}
                <button
                  onClick={() => toggleCompany(group.companyId)}
                  className="w-full flex items-center justify-between p-4 hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center">
                      <Building2 size={18} className="text-white" />
                    </div>
                    <div className="text-right">
                      <h3 className="font-bold text-text-primary text-sm">{group.companyName}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-text-secondary">{group.users.length} مستخدم</span>
                        {adminUser && (
                          <span className="text-xs text-text-muted">• المدير: {adminUser.name}</span>
                        )}
                        {additionalUsers.length > 0 && (
                          <span className="text-xs text-text-secondary">• {additionalUsers.length} إضافي</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(group.isActive)}
                    {isExpanded ? <ChevronUp size={18} className="text-text-muted" /> : <ChevronDown size={18} className="text-text-muted" />}
                  </div>
                </button>

                {/* Users List */}
                {isExpanded && (
                  <div className="border-t border-border divide-y divide-border">
                    {group.users.map((user, idx) => (
                      <div
                        key={user.id}
                        className="flex items-center gap-3 p-3 hover:bg-bg-hover transition-colors cursor-pointer"
                        onClick={() => router.push(`/zerocold/users/${user.id}`)}
                      >
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                          {user.name.charAt(0)}
                        </div>

                        {/* User Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium text-text-primary truncate">{user.name}</h4>
                            {idx === 0 && user.role === 'admin' && (
                              <span className="text-xs px-1.5 py-0.5 bg-accent/20 text-accent rounded font-medium">مدير الشركة</span>
                            )}
                            {idx > 0 && (
                              <span className="text-xs px-1.5 py-0.5 bg-blue-600/20 text-blue-400 rounded">إضافي</span>
                            )}
                          </div>
                          <p className="text-xs text-text-muted truncate" dir="ltr">{user.email}</p>
                        </div>

                        {/* Badges */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs px-1.5 py-0.5 bg-bg-primary text-text-secondary rounded">
                            {roleLabels[user.role] || user.role}
                          </span>
                          {statusBadge(user.is_active)}
                          {user.email_verified && (
                            <span className="text-xs text-green-500">✓</span>
                          )}
                        </div>

                        <Eye size={16} className="text-text-muted shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

