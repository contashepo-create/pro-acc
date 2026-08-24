import React from 'react';

/** Mock for next/link that renders a plain anchor. */
export default function Link({ href, children, ...rest }: { href: string; children?: React.ReactNode } & Record<string, unknown>) {
  return React.createElement('a', { href, ...rest }, children);
}
