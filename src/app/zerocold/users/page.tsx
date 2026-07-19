'use client';

import { useState, useEffect } from 'react';
import { Users, Search, Loader2, Eye, Shield, Calendar, Clock } from 'lucide-react';

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

  const loadUsers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

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

  const roleLabels: Record<string, string> = {
    admin: 'مدير النظام',
    manager: 'مدير',
    accountant: 'محاسب',
    supervisor: 'مشرف',
  };

  const statusBadge = (active: boolean) => (
    <span className={`px-2 py-1 rounded-full text-xs border ${
      active 
        ? 'bg-green-100 text-green-700 border-green-200' 
        : 'bg-gray-100 text-gray-700 border-gray-200'
    }`}>
      {active ? 'نشط' : 'غير نشط'}
    </span>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 size={40} className="animate-spin text-accent mx-auto mb-4" />
          <p className="text-text-muted">جاري تحميل المستخدمين...</p>
        </div>
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
            <p className="text-xs text-text-muted">{users.length} مستخدم مسجل</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="glass rounded-xl p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="بحث بالاسم، البريد الإلكتروني، أو اسم الشركة..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-base w-full pr-10"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filterStatus === 'all'
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 text-text-muted hover:bg-gray-200'
              }`}
            >
              الكل
            </button>
            <button
              onClick={() => setFilterStatus('active')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filterStatus === 'active'
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 text-text-muted hover:bg-gray-200'
              }`}
            >
              نشط
            </button>
            <button
              onClick={() => setFilterStatus('inactive')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filterStatus === 'inactive'
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 text-text-muted hover:bg-gray-200'
              }`}
            >
              غير نشط
            </button>
          </div>
        </div>
      </div>

      {/* Users List */}
      {filteredUsers.length === 0 ? (
        <div className="text-center py-12">
          <Users size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-text-muted">
            {searchTerm || filterStatus !== 'all' 
              ? 'لا توجد نتائج مطابقة' 
              : 'لا يوجد مستخدمين مسجلين'}
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((user) => (
            <div
              key={user.id}
              className="glass rounded-xl p-5 hover:shadow-lg transition-shadow cursor-pointer group"
              onClick={() => window.location.href = `/zerocold/users/${user.id}`}
            >
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shrink-0">
                  {user.name.charAt(0)}
                </div>

                <div className="flex-1 min-w-0">
                  {/* User Name & Email */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-text-primary truncate">{user.name}</h3>
                      <p className="text-xs text-text-muted truncate" dir="ltr">{user.email}</p>
                    </div>
                    <Eye size={18} className="text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2" />
                  </div>

                  {/* Company Info */}
                  <div className="mb-3">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {user.company.name}
                    </p>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs px-2 py-1 bg-accent/10 text-accent rounded font-medium">
                      {roleLabels[user.role] || user.role}
                    </span>
                    {statusBadge(user.is_active)}
                    {user.email_verified && (
                      <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                        ✓ موثق
                      </span>
                    )}
                  </div>

                  {/* Footer Info */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
                    <div className="flex items-center gap-1 text-xs text-text-muted">
                      <Calendar size={12} />
                      <span dir="ltr">{new Date(user.created_at).toLocaleDateString('ar-SA')}</span>
                    </div>
                    {user.last_login && (
                      <div className="flex items-center gap-1 text-xs text-text-muted">
                        <Clock size={12} />
                        <span dir="ltr">{new Date(user.last_login).toLocaleDateString('ar-SA')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}