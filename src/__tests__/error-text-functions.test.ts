/** errorText: safe message extraction without widening to `any`. */

import { errorText } from '@/lib/errors';

describe('errorText', () => {
  test('returns Error messages, plain strings, and object message fields', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('plain message')).toBe('plain message');
    expect(errorText({ message: 'postgrest error' })).toBe('postgrest error');
  });

  test('falls back to an empty string for anything else', () => {
    expect(errorText(null)).toBe('');
    expect(errorText(undefined)).toBe('');
    expect(errorText(42)).toBe('');
    expect(errorText({ message: 7 })).toBe('');
    expect(errorText({ code: '22P02' })).toBe('');
  });
});
