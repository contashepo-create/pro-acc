import { NextRequest } from 'next/server';
import { success, error, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseBody(req);
    const s = sb();

    const { data: result, error: updateError } = await s.from('currencies')
      .update({
        code: body.code,
        name: body.name,
        rate: body.rate,
        is_base: body.isBase,
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (updateError || !result) return error('Currency not found', 404);
    return success(result);
  } catch (e: any) {
    return error(e.message);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const s = sb();

    const { data: result, error: deleteError } = await s.from('currencies')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (deleteError || !result) return error('Currency not found', 404);
    return success({ deleted: true });
  } catch (e: any) {
    return error(e.message);
  }
}
