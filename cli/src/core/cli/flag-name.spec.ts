import { missingFlagsMessage, toFlagName } from './flag-name';

describe('toFlagName', () => {
  it('kebab-cases a camelCase key', () => {
    expect(toFlagName('periodStart')).toBe('--period-start');
    expect(toFlagName('timeEntries')).toBe('--time-entries');
    expect(toFlagName('unitPrice')).toBe('--unit-price');
  });

  it('leaves a single-word key alone', () => {
    expect(toFlagName('name')).toBe('--name');
    expect(toFlagName('currency')).toBe('--currency');
  });
});

describe('missingFlagsMessage', () => {
  it('renders each key as its real kebab-case flag, not the raw DTO key', () => {
    const message = missingFlagsMessage(['periodStart', 'periodEnd']);

    expect(message).toBe('Missing required flag(s): --period-start, --period-end.');
    expect(message).not.toContain('--periodStart');
    expect(message).not.toContain('--periodEnd');
  });
});
