'use client';

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}

export function PageContainer({ children, className = '', maxWidth }: PageContainerProps) {
  return (
    <div
      className={`page-enter p-3 sm:p-4 md:p-6 ${className}`}
      style={maxWidth ? { maxWidth, marginLeft: 'auto', marginRight: 'auto' } : undefined}
    >
      {children}
    </div>
  );
}
