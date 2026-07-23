'use client';

import { useState, useEffect } from 'react';
import { Users, Search, Loader2, Eye, Calendar, Clock, Building2, ChevronDown, ChevronUp } from 'lucide-react';

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
      active ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-700 border-gray-200'
    }`}>{active ? 'نشط' : 'غير نشط'}</span>
  );

  const toggleCompany = (companyId: string) => {
    setExpandedCompanies(prev => ({ ...prev, [companyId]: !prev[companyId] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={40} className="animate-spin text-amber-500 mx-auto mb-4" />
        <p className="text-gray-400">جاري تحميل المستخدمين...</p>
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
            <h1 className="text-xl font-bold text-white">المستخدمون</h1>
            <p className="text-xs text-gray-400">{users.length} مستخدم — {Object.keys(companyGroups).length} شركة</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[#15101b] border border-[#1f1725] rounded-xl p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="بحث بالاسم، البريد، أو الشركة..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-[#1f1725] rounded-lg pr-10 pl-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50"
              />
            </div>
          </div>
          <div className="flex gap-2">
            {(['all', 'active', 'inactive'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === s ? 'bg-amber-600 text-white' : 'bg-[#0a0a0f] text-gray-400 hover:bg-[#1f1725]'
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
          <Users size={40} className="mx-auto text-gray-700 mb-3" />
          <p className="text-gray-500">لا توجد نتائج</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.values(companyGroups).map(group => {
            const isExpanded = expandedCompanies[group.companyId] !== false; // default expanded
            const adminUser = group.users.find(u => u.role === 'admin') || group.users[0];
            const additionalUsers = group.users.filter(u => u.id !== adminUser.id);

            return (
              <div key={group.companyId} className="bg-[#15101b] border border-[#1f1725] rounded-xl overflow-hidden">
                {/* Company Header */}
                <button
                  onClick={() => toggleCompany(group.companyId)}
                  className="w-full flex items-center justify-between p-4 hover:bg-[#1a1520] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center">
                      <Building2 size={18} className="text-white" />
                    </div>
                    <div className="text-right">
                      <h3 className="font-bold text-white text-sm">{group.companyName}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{group.users.length} مستخدم</span>
                        {adminUser && (
                          <span className="text-xs text-gray-500">• المدير: {adminUser.name}</span>
                        )}
                        {additionalUsers.length > 0 && (
                          <span className="text-xs text-amber-500/70">• {additionalUsers.length} إضافي</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(group.isActive)}
                    {isExpanded ? <ChevronUp size={18} className="text-gray-500" /> : <ChevronDown size={18} className="text-gray-500" />}
                  </div>
                </button>

                {/* Users List */}
                {isExpanded && (
                  <div className="border-t border-[#1f1725] divide-y divide-[#1f1725]">
                    {group.users.map((user, idx) => (
                      <div
                        key={user.id}
                        className="flex items-center gap-3 p-3 hover:bg-[#1a1520] transition-colors cursor-pointer"
                        onClick={() => window.location.href = `/zerocold/users/${user.id}`}
                      >
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                          {user.name.charAt(0)}
                        </div>

                        {/* User Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium text-white truncate">{user.name}</h4>
                            {idx === 0 && user.role === 'admin' && (
                              <span className="text-xs px-1.5 py-0.5 bg-amber-600/20 text-amber-400 rounded">مدير الشركة</span>
                            )}
                            {idx > 0 && (
                              <span className="text-xs px-1.5 py-0.5 bg-blue-600/20 text-blue-400 rounded">إضافي</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 truncate" dir="ltr">{user.email}</p>
                        </div>

                        {/* Badges */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs px-1.5 py-0.5 bg-[#0a0a0f] text-gray-400 rounded">
                            {roleLabels[user.role] || user.role}
                          </span>
                          {statusBadge(user.is_active)}
                          {user.email_verified && (
                            <span className="text-xs text-green-500">✓</span>
                          )}
                        </div>

                        <Eye size={16} className="text-gray-600 shrink-0" />
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
