import { success, serverError } from '@/lib/api-helpers';

export async function POST() {
  try {
    const response = success({ message: 'تم تسجيل الخروج بنجاح' });
    response.cookies.set('token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });
    return response;
  } catch (err) {
    return serverError(err);
  }
}
