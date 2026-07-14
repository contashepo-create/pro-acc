import { NextRequest } from 'next/server';
import { success } from '@/lib/api-helpers';

/**
 * GET /api/docs/openapi.json — Auto-generated OpenAPI 3.0 specification
 * Documents all Pro Acc API routes with types, auth requirements, and examples
 */
export async function GET(request: NextRequest) {
  const host = request.headers.get('host') || 'localhost:3000';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  const baseUrl = `${protocol}://${host}`;

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Pro Acc — نظام محاسبة المقاولات API',
      description: `
## Pro Acc API Documentation

نظام محاسبة وإدارة مالية متكامل مخصص لشركات المقاولات في السعودية والخليج.

### المصادقة (Authentication)
جميع المسارات المحمية تتطلب JWT token في Cookie أو Header:
\`\`\`
Authorization: Bearer <token>
\`\`\`

### الأدوار (RBAC)
| الدور | الصلاحيات |
|-------|-----------|
| admin | صلاحيات كاملة + إدارة المستخدمين والإعدادات |
| manager | إنشاء/تعديل/حذف معظم البيانات |
| accountant | إنشاء/تعديل القيود والفواتير |
| supervisor | عرض + إنشاء سندات محدودة |

### ZATCA Phase 2
الفواتير تُنشأ مع QR code تلقائي (TLV) + UBL 2.1 XML متاح عبر \`/api/invoices/{id}/zatca\`
      `.trim(),
      version: '2.0.0',
      contact: { name: 'Pro Acc Team' },
    },
    servers: [
      { url: baseUrl, description: 'Current server' },
    ],
    tags: [
      { name: 'Auth', description: 'المصادقة والتسجيل' },
      { name: 'Accounts', description: 'دليل الحسابات' },
      { name: 'Journal', description: 'القيود اليومية' },
      { name: 'Invoices', description: 'فواتير المبيعات' },
      { name: 'Vouchers', description: 'سندات القبض والصرف' },
      { name: 'Cash', description: 'سندات الصندوق' },
      { name: 'Clients', description: 'العملاء والموردين' },
      { name: 'Projects', description: 'المشاريع والتكاليف' },
      { name: 'Reports', description: 'التقارير المالية' },
      { name: 'Settings', description: 'إعدادات الشركة' },
      { name: 'Users', description: 'إدارة المستخدمين' },
      { name: 'ZATCA', description: 'الفوترة الإلكترونية' },
      { name: 'Admin', description: 'لوحة تحكم المطوّر' },
    ],
    paths: {
      // Auth
      '/api/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'تسجيل الدخول',
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } }, required: ['email', 'password'] } } }
          },
          responses: { '200': { description: 'تم تسجيل الدخول بنجاح' }, '401': { description: 'بيانات غير صحيحة' } }
        }
      },
      '/api/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'تسجيل شركة جديدة',
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { companyName: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' } }, required: ['companyName', 'name', 'email', 'password'] } } }
          },
          responses: { '201': { description: 'تم التسجيل بنجاح' } }
        }
      },
      '/api/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'بيانات المستخدم الحالي',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'بيانات المستخدم' } }
        }
      },

      // Accounts
      '/api/accounts': {
        get: { tags: ['Accounts'], summary: 'قائمة الحسابات (شجرة)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'شجرة الحسابات' } } },
        post: { tags: ['Accounts'], summary: 'إضافة حساب', security: [{ bearerAuth: [] }], responses: { '201': { description: 'تم الإضافة' } } }
      },
      '/api/accounts/{id}': {
        get: { tags: ['Accounts'], summary: 'تفاصيل حساب', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'تفاصيل الحساب' } } },
        put: { tags: ['Accounts'], summary: 'تعديل حساب', security: [{ bearerAuth: [] }], responses: { '200': { description: 'تم التعديل' } } },
        delete: { tags: ['Accounts'], summary: 'حذف حساب (manager+)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'تم الحذف' } } }
      },

      // Journal
      '/api/journal': {
        get: { tags: ['Journal'], summary: 'قائمة القيود اليومية', security: [{ bearerAuth: [] }], responses: { '200': { description: 'القيود' } } },
        post: { tags: ['Journal'], summary: 'إضافة قيد (ذري مع create_journal_entry RPC)', security: [{ bearerAuth: [] }], responses: { '201': { description: 'تم الإضافة' } } }
      },
      '/api/journal/{id}': {
        get: { tags: ['Journal'], summary: 'تفاصيل قيد', security: [{ bearerAuth: [] }], responses: { '200': { description: 'القيد مع سطور' } } },
        delete: { tags: ['Journal'], summary: 'حذف قيد (manager+)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'تم الحذف' } } }
      },

      // Invoices
      '/api/invoices': {
        get: { tags: ['Invoices'], summary: 'قائمة الفواتير', security: [{ bearerAuth: [] }], responses: { '200': { description: 'الفواتير مع zatca_qr' } } },
        post: { tags: ['Invoices'], summary: 'إنشاء فاتورة (مع QR ZATCA تلقائي)', security: [{ bearerAuth: [] }], responses: { '201': { description: 'الفاتورة + zatcaQRData' } } }
      },

      // ZATCA
      '/api/invoices/{id}/zatca': {
        get: { tags: ['ZATCA'], summary: 'QR + UBL XML للفاتورة', security: [{ bearerAuth: [] }], responses: { '200': { description: 'qrData + ublXml' } } }
      },

      // Cash
      '/api/cash': {
        get: { tags: ['Cash'], summary: 'سندات الصندوق', security: [{ bearerAuth: [] }], responses: { '200': { description: 'السندات' } } },
        post: { tags: ['Cash'], summary: 'إضافة سند صندوق (ترقيم ذري)', security: [{ bearerAuth: [] }], responses: { '201': { description: 'تم' } } }
      },

      // Vouchers
      '/api/vouchers/receipt': {
        get: { tags: ['Vouchers'], summary: 'سندات القبض', security: [{ bearerAuth: [] }], responses: { '200': { description: 'السندات' } } },
        post: { tags: ['Vouchers'], summary: 'إضافة سند قبض', security: [{ bearerAuth: [] }], responses: { '201': { description: 'تم' } } }
      },
      '/api/vouchers/disbursement': {
        get: { tags: ['Vouchers'], summary: 'سندات الصرف', security: [{ bearerAuth: [] }], responses: { '200': { description: 'السندات' } } },
        post: { tags: ['Vouchers'], summary: 'إضافة سند صرف', security: [{ bearerAuth: [] }], responses: { '201': { description: 'تم' } } }
      },

      // Users
      '/api/company/users': {
        get: { tags: ['Users'], summary: 'قائمة المستخدمين (admin)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'users + currentCount + maxUsers' } } },
        post: { tags: ['Users'], summary: 'دعوة مستخدم (admin + max_users check)', security: [{ bearerAuth: [] }], responses: { '201': { description: 'تم' } } }
      },

      // Settings
      '/api/settings': {
        get: { tags: ['Settings'], summary: 'إعدادات الشركة', security: [{ bearerAuth: [] }], responses: { '200': { description: 'الإعدادات' } } },
        put: { tags: ['Settings'], summary: 'تعديل إعدادات (admin فقط)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'تم' } } }
      },

      // Reports
      '/api/reports/financial': {
        get: { tags: ['Reports'], summary: 'التقرير المالي', security: [{ bearerAuth: [] }], responses: { '200': { description: 'ميزان المراجعة + قائمة الدخل' } } }
      },

      // Notifications
      '/api/notifications/smart': {
        get: { tags: ['Reports'], summary: 'إشعارات ذكية (فواتير متأخرة، نهاية سنة، أرصدة...)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'notifications[]' } } }
      },

      // Assistant
      '/api/assistant': {
        post: { tags: ['Reports'], summary: 'المساعد الذكي — اسأل عن أرباح، فواتير، مشاريع', security: [{ bearerAuth: [] }], responses: { '200': { description: 'response + suggestions' } } }
      },

      // Backup
      '/api/backup/auto': {
        get: { tags: ['Settings'], summary: 'حالة النسخ الاحتياطي (admin)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'backups + dataSummary' } } },
        post: { tags: ['Settings'], summary: 'إنشاء نسخة احتياطية (admin)', security: [{ bearerAuth: [] }], responses: { '201': { description: 'backupUrl + sizeBytes' } } }
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token — يُمرر عبر Cookie (token) أو Header (Authorization: Bearer <token>)',
        },
      },
      schemas: {
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            number: { type: 'integer' },
            date: { type: 'string', format: 'date' },
            due_date: { type: 'string', format: 'date' },
            subtotal: { type: 'number' },
            vat_rate: { type: 'number' },
            vat_amount: { type: 'number' },
            total: { type: 'number' },
            status: { type: 'string', enum: ['unpaid', 'partial', 'paid'] },
            zatca_qr: { type: 'string', description: 'Base64 TLV for ZATCA QR code' },
            contact_id: { type: 'string', format: 'uuid' },
            project_id: { type: 'string', format: 'uuid' },
          },
        },
        JournalEntry: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            number: { type: 'integer' },
            date: { type: 'string', format: 'date' },
            type: { type: 'string' },
            description: { type: 'string' },
            totalDebit: { type: 'number' },
            totalCredit: { type: 'number' },
            lines: { type: 'array', items: { $ref: '#/components/schemas/JournalLine' } },
          },
        },
        JournalLine: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            account_code: { type: 'string' },
            account_name: { type: 'string' },
            debit: { type: 'number' },
            credit: { type: 'number' },
            description: { type: 'string' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'manager', 'accountant', 'supervisor'] },
            is_active: { type: 'boolean' },
          },
        },
      },
    },
  };

  return success(spec, 200, { cache: 'public', maxAge: 3600 });
}
