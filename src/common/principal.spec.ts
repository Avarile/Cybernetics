import { GUEST_PRINCIPAL, SYSTEM_PRINCIPAL } from './principal';

describe('principals', () => {
  it('system principal is the internal agent caller', () => {
    expect(SYSTEM_PRINCIPAL).toEqual({ id: null, role: 'agent' });
  });
  it('guest principal is anonymous', () => {
    expect(GUEST_PRINCIPAL).toEqual({ id: null, role: 'guest' });
  });
});
