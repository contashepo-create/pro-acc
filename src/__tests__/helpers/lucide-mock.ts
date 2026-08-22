import React from 'react';

/**
 * Mock for lucide-react icons: each named export renders a lightweight span so
 * tests don't need to load the real SVG icon set.
 */
const icons = new Set([
  'Gift', 'Image', 'Crown', 'AlertTriangle', 'Info', 'Zap', 'Star', 'X',
  'Megaphone', 'Download', 'MessageSquare', 'Menu', 'LogOut', 'User', 'Bell',
  'ChevronDown', 'ChevronLeft', 'ChevronRight', 'Plus', 'Search', 'Trash2',
  'Pencil', 'Eye', 'Check', 'CheckCircle2', 'XCircle', 'Lock', 'Mail', 'Phone',
  'Settings', 'Home', 'Building2', 'Folder', 'BarChart3', 'FileText', 'Database', 'Inbox', 'TrendingUp', 'TrendingDown', 'CheckCircle', 'AlertCircle', 'MoreVertical', 'Clock', 'Calendar', 'ArrowRight', 'Loader2', 'Columns', 'CheckSquare', 'SearchX', 'Filter',
]);

const handler: Record<string, any> = {};
for (const name of [...icons]) {
  handler[name] = (props: any) =>
    React.createElement('span', { 'data-icon': name, ...props }, name);
}

export const mockIcon = (name: string) => handler[name] || ((props: any) => React.createElement('span', { 'data-icon': name, ...props }, name));

module.exports = handler;
module.exports.default = {};
