import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'employees', 'read');
    const { id } = await params;
    const s = sb();

    const { data: employee } = await s.from('employees')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!employee) return notFound();

    return success(employee);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: existing } = await s.from('employees')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const updateData: any = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) return error('الاسم مطلوب');
      updateData.name = body.name.trim();
    }
    if (body.phone !== undefined) updateData.phone = typeof body.phone === 'string' ? body.phone.trim() || null : null;
    if (body.email !== undefined) {
      if (body.email && (typeof body.email !== 'string' || body.email.length>320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) return error('البريد الإلكتروني غير صالح');
      updateData.email = typeof body.email === 'string' ? body.email.trim().toLowerCase() || null : null;
    }
    if (body.salary !== undefined) {
      const salary = Number(body.salary);
      if (!Number.isFinite(salary) || salary<0 || salary!==Math.round(salary*100)/100) return error('الراتب غير صالح');
      updateData.salary = salary;
    }
    if (body.department !== undefined) updateData.department = typeof body.department === 'string' ? body.department.trim() || null : null;
    if (body.position !== undefined) updateData.position = typeof body.position === 'string' ? body.position.trim() || null : null;
    if (body.hire_date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.hire_date))) return error('تاريخ التعيين غير صالح');
      updateData.hire_date = body.hire_date;
    }
    if (Object.keys(updateData).length===0) return error('لا توجد حقول صالحة للتعديل');

    const { data: updated, error: updateErr } = await s.from('employees')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: existing, error: existingErr } = await s.from('employees')
      .select('id,is_active')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return notFound();
    if ((existing as any).is_active===false) return error('الموظف غير نشط بالفعل',409);

    // Employee IDs are referenced by payroll, advances, custodies, equipment,
    // and projects. Preserve that history and retire the employee instead of
    // attempting a destructive delete based on an incomplete link check.
    const { data: deactivated, error: deactivateErr } = await s.from('employees')
      .update({is_active:false})
      .eq('id',id).eq('company_id',auth.companyId).eq('is_active',true)
      .select('id,is_active').maybeSingle();
    if (deactivateErr) throw deactivateErr;
    if (!deactivated) return error('تغيرت حالة الموظف بواسطة طلب آخر',409);
    return success({ deactivated: true, employee: deactivated });
  } catch (err) {
    return handleApiError(err);
  }
}
