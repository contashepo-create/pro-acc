import { pickContactFields } from '@/lib/contact-fields';

describe('pickContactFields', () => {
  test('keeps commercial registration and city', () => {
    const { error, data } = pickContactFields({
      name: 'شركة النور',
      commercial_registration: '1234567890',
      city: 'المنصورة',
      tax_number: '300000000000003',
    }, { requireName: true });
    expect(error).toBeNull();
    expect(data?.commercial_registration).toBe('1234567890');
    expect(data?.city).toBe('المنصورة');
    expect(data?.tax_number).toBe('300000000000003');
  });

  test('normalizes empty/non-string/numeric fields and ignores absent fields', () => {
    expect(pickContactFields({ phone: '', category: 7, credit_limit: '12.5' }).data).toEqual({ phone: null, category: 7, credit_limit: 12.5 });
    expect(pickContactFields({ credit_limit: 'bad' }).data?.credit_limit).toBe(0);
    expect(pickContactFields({ unknown: 'x' }).data).toEqual({});
    expect(pickContactFields({ name: ' A ' }).data?.name).toBe('A');
  });

  test('validates email only when a nonempty string is provided', () => {
    expect(pickContactFields({ email: 'bad' }).error).toContain('البريد');
    expect(pickContactFields({ email: '' }).error).toBeNull();
    expect(pickContactFields({ email: 'a@b.com' }).error).toBeNull();
  });

  test('rejects empty name when required', () => {
    const { error } = pickContactFields({ name: '  ' }, { requireName: true });
    expect(error).toBeTruthy();
  });
});
