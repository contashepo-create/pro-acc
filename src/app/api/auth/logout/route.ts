import { success, serverError, clearAuthCookie } from '@/lib/api-helpers';

export async function POST() {
  try {
    const response = success({ message: 'تم تسجيل الخروج بنجاح' });
    clearAuthCookie(response, 'token');
    return response;
  } catch (err) {
    return serverError(err);
  }
}
