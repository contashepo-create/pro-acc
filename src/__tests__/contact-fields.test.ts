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

  test('rejects empty name when required', () => {
    const { error } = pickContactFields({ name: '  ' }, { requireName: true });
    expect(error).toBeTruthy();
  });
});
