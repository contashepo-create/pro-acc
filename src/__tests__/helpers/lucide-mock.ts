import React from 'react';

/**
 * Proxy-based mock for lucide-react: every named export renders a lightweight
 * span, so tests never need to load the real SVG icon set nor enumerate icons.
 */
const iconHandler: Record<string, any> = {
  default: {},
};

function Icon(name: string) {
  return function MockIcon(props: any) {
    return React.createElement('span', { 'data-icon': name, ...props }, name);
  };
}

const handler: Record<string, any> = new Proxy(iconHandler, {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined;
    if (prop === 'default') return {};
    if (prop === '__esModule') return true;
    return iconHandler[prop] || (iconHandler[prop] = Icon(prop));
  },
});

module.exports = handler;
