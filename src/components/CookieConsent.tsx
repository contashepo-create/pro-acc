'use client';
import { useEffect, useState } from 'react';
export function CookieConsent() {
 const [visible,setVisible]=useState(false);
 useEffect(()=>{setVisible(localStorage.getItem('cookie_consent')===null)},[]);
 if(!visible)return null;
 return <div dir="rtl" className="fixed bottom-4 inset-x-4 z-[100] mx-auto max-w-2xl rounded-xl border border-border bg-bg-card p-4 shadow-2xl"><p className="text-sm text-text-primary">نستخدم ملف تعريف ارتباط تقنيًا ضروريًا ومعرّفًا عشوائيًا مجهولًا لقياس عدد الزوار ومنع إساءة الاستخدام. لا نستخدمه للإعلانات ولا نبيع بياناتك.</p><div className="mt-3 flex gap-2"><button onClick={()=>{localStorage.setItem('cookie_consent','accepted');setVisible(false)}} className="rounded-lg bg-accent px-4 py-2 text-xs text-white">موافق</button><button onClick={()=>{localStorage.setItem('cookie_consent','rejected');setVisible(false)}} className="rounded-lg border border-border px-4 py-2 text-xs text-text-secondary">رفض التحليلات</button></div></div>;
}
