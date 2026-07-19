import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

const sb = () => getSupabase();

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) throw new Error('Unauthorized');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') throw new Error('Unauthorized');
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const s = sb();
    const { data, error: err } = await s.from('subscription_plans')
      .select('*')
      .order('sort_order');
    if (err) {
      console.error('Error fetching plans:', err);
      return success({ plans: [] });
    }
    return success({ plans: data || [] });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
    const body = await parseBody(req);
    const { 
      code, name, description, description_ar,
      priceMonthly, price_monthly, priceYearly, price_yearly, 
      yearly_discount_percent, trial_days,
      maxUsers, max_users, max_clients, max_suppliers, max_employees,
      maxProjects, max_projects, max_invoices_per_month, max_storage_mb,
      features, features_modules, is_active, sort_order 
    } = body;

    if (!code || !name) return error('code and name are required');

    const s = sb();
    
    const insertData: any = {
      code,
      name,
      description: description || '',
      description_ar: description_ar || '',
      price_monthly: priceMonthly || price_monthly || 0,
      price_yearly: priceYearly || price_yearly || null,
      yearly_discount_percent: yearly_discount_percent || 20,
      trial_days: trial_days || 7,
      max_users: maxUsers || max_users || 1,
      max_clients: max_clients || 10,
      max_suppliers: max_suppliers || 10,
      max_employees: max_employees || 5,
      max_projects: maxProjects || max_projects || null,
      max_invoices_per_month: max_invoices_per_month || 50,
      max_storage_mb: max_storage_mb || 100,
      features: features ? JSON.stringify(features) : '[]',
      features_modules: features_modules ? (typeof features_modules === 'string' ? features_modules : JSON.stringify(features_modules)) : '{}',
      is_active: is_active !== undefined ? is_active : true,
      sort_order: sort_order || 0,
    };

    // محاولة الإدراج - إذا فشل بسبب عمود غير موجود، نحاول بالحقول الأساسية
    let { data, error: insertErr } = await s.from('subscription_plans')
      .insert(insertData)
      .select()
      .single();

    if (insertErr && insertErr.message?.includes('column')) {
      console.warn('Some columns may not exist, trying with basic fields:', insertErr.message);
      
      const basicData: any = {
        code,
        name,
        description: description || '',
        price_monthly: priceMonthly || price_monthly || 0,
        price_yearly: priceYearly || price_yearly || null,
        max_users: maxUsers || max_users || 1,
        max_projects: maxProjects || max_projects || null,
        is_active: is_active !== undefined ? is_active : true,
        sort_order: sort_order || 0,
      };

      const retry = await s.from('subscription_plans')
        .insert(basicData)
        .select()
        .single();

      if (retry.error) {
        console.error('Retry also failed:', retry.error);
        return error('فشل إضافة الباقة: ' + retry.error.message, 500);
      }
      data = retry.data;
    } else if (insertErr) {
      console.error('Insert error:', insertErr);
      return error('فشل إضافة الباقة: ' + insertErr.message, 500);
    }

    return success(data, 201);
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    console.error('Plans POST error:', e);
    return serverError(e);
  }
}
