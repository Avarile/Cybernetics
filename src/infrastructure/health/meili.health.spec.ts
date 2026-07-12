import { MeiliHealthIndicator } from './meili.health';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

describe('MeiliHealthIndicator', () => {
  const up = jest.fn(() => ({ meili: { status: 'up' } }));
  const down = jest.fn((d) => ({ meili: { status: 'down', ...d } }));
  const svc = { check: jest.fn(() => ({ up, down })) } as any;

  it('reports up when the client is healthy', async () => {
    const client = { isHealthy: jest.fn(async () => true) } as any;
    await new MeiliHealthIndicator(svc, client).isHealthy('meili');
    expect(up).toHaveBeenCalled();
  });

  it('reports down when the client throws', async () => {
    const client = {
      isHealthy: jest.fn(async () => {
        throw new Error('x');
      }),
    } as any;
    await new MeiliHealthIndicator(svc, client).isHealthy('meili');
    expect(down).toHaveBeenCalled();
  });
});
