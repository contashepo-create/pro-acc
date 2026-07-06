import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@accweb.com';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.warn('SMTP not configured — email not sent');
    return false;
  }
  try {
    await t.sendMail({ from: FROM_EMAIL, to, subject, html });
    return true;
  } catch (err) {
    console.error('Failed to send email:', err);
    return false;
  }
}

export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<boolean> {
  const html = `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #f9f9fb; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="font-size: 22px; color: #1a1a2e; margin: 0;">إعادة تعيين كلمة المرور</h1>
      </div>
      <p style="color: #333; font-size: 15px; line-height: 1.7;">مرحباً،</p>
      <p style="color: #333; font-size: 15px; line-height: 1.7;">لقد تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك في <strong>AccWeb</strong>.</p>
      <p style="color: #333; font-size: 15px; line-height: 1.7;">اضغط على الرابط أدناه لإعادة تعيين كلمة المرور. هذا الرابط صالح لمدة <strong>ساعة واحدة</strong>:</p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${resetUrl}" style="display: inline-block; padding: 14px 36px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 15px;">إعادة تعيين كلمة المرور</a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد الإلكتروني.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #999; font-size: 11px; text-align: center;">AccWeb © ${new Date().getFullYear()} — نظام محاسبة متكامل</p>
    </div>`;
  return sendEmail(email, 'إعادة تعيين كلمة المرور - AccWeb', html);
}
