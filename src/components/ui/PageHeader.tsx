'use client';

import React, { type ReactNode, type ElementType } from 'react';
import { ArrowRight } from 'lucide-react';

interface Breadcrumb {
  label: string;
  onClick?: () => void;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  onBack?: () => void;
  breadcrumbs?: Breadcrumb[];
  icon?: ElementType;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  onBack,
  breadcrumbs,
  icon: Icon,
  className = '',
}: PageHeaderProps) {

  return (
    <div className={`page-header ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1.5 mb-2 text-sm text-text-muted">
          {breadcrumbs.map((crumb, index) => (
            <span key={index} className="inline-flex items-center gap-1.5">
              {index > 0 && <span className="text-text-muted/50">/</span>}
              {crumb.onClick ? (
                <button
                  className="hover:text-text-secondary transition-colors"
                  onClick={crumb.onClick}
                >
                  {crumb.label}
                </button>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="btn-icon text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              aria-label="رجوع"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-2">
            {Icon && <Icon size={22} className="text-accent shrink-0" />}
            <div>
              <h1>{title}</h1>
              {description && <p>{description}</p>}
            </div>
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
