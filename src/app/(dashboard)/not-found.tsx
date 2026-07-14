import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8" dir="rtl">
      <div className="text-6xl font-bold text-gray-300 mb-4">404</div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">الصفحة غير موجودة</h2>
      <p className="text-gray-500 mb-6">الصفحة التي تبحث عنها غير موجودة أو تم نقلها.</p>
      <Link
        href="/dashboard"
        className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
      >
        العودة للوحة التحكم
      </Link>
    </div>
  );
}
