import { NextRequest } from 'next/server';
import { success, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getCompanySubscription } from '@/lib/subscription';

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const sub = await getCompanySubscription(companyId);
    return success(sub);
  } catch (err) {
    return handleApiError(err);
  }
}
