import { describe, expect, it } from 'vitest';
import { createCommercialScheduler } from '../commercial/scheduler.js';

describe('commercial scheduler', () => {
  it('exports the shared-worker scheduler factory', () => {
    expect(createCommercialScheduler).toBeTypeOf('function');
  });
});
