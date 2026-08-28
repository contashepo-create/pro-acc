import type { Metadata, Viewport } from 'next';
// Self-hosted fonts (no build-time dependency on Google Fonts, better
// privacy for visitors — no request leaves the origin).
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import Providers from '@/components/Providers';
import { ThemeInitializer } from '@/components/ThemeInitializer';
import { VisitorTracker } from '@/components/VisitorTracker';
import './globals.css';

export const metadata: Metadata = {
  title: 'برو أكاوننت - نظام محاسبة المقاولات',
  description: 'نظام محاسبة وإدارة مالية متكامل مخصص لشركات المقاولات في السعودية والخليج',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Pro Acc',
  },
  icons: {
    icon: '/window.svg',
    apple: '/window.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`font-ibm-plex-sans-arabic font-plus-jakarta-sans h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var id=JSON.parse(localStorage.getItem('accweb_theme_id')||'"sapphire"');var dark=JSON.parse(localStorage.getItem('accweb_theme_dark')||'false');var r=document.documentElement;['theme-sapphire','theme-amber','theme-teal','light'].forEach(function(c){r.classList.remove(c)});r.classList.add('theme-'+(id||'sapphire'));if(!dark)r.classList.add('light');}catch(e){document.documentElement.classList.add('theme-sapphire','light');}})();`,
          }}
        />
        <ThemeInitializer />
        <VisitorTracker />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
