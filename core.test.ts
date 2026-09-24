import { describe, it, expect } from 'vitest';
import { next, nextQuestion, startsNewTrip, InvalidTransition } from '../src/lib/state-machine';
import { findDuplicates } from '../src/lib/agency';

describe('state machine', () => {
  it('runs a full cycle', () => {
    let s = next('AT_PLANT', 'LOAD_TAKEN'); s = next(s, 'LEFT_PLANT'); s = next(s, 'REACHED_AGENCY');
    s = next(s, 'UNLOADING_STARTED'); s = next(s, 'EMPTY'); s = next(s, 'LEFT_AGENCY'); s = next(s, 'REACHED_PLANT');
    expect(s).toBe('AT_PLANT_WAITING_FOR_LOAD');
  });
  it('reaching plant does not start a new trip; new load does', () => {
    expect(startsNewTrip('RETURNING_TO_PLANT', 'REACHED_PLANT')).toBe(false);
    expect(startsNewTrip('AT_PLANT_WAITING_FOR_LOAD', 'NEW_LOAD_TAKEN')).toBe(true);
  });
  it('rejects invalid transitions', () => expect(() => next('AT_PLANT', 'EMPTY')).toThrow(InvalidTransition));
  it('does not re-ask known agency', () => {
    expect(nextQuestion('LOADED', {}).ask).toBe('AGENCY');
    expect(nextQuestion('LOADED', { agencyName: 'X' }).ask).toBe('LEFT_PLANT');
  });
  it('does not re-ask empty time once known', () =>
    expect(nextQuestion('UNLOADING', { expectedEmptyAt: new Date() }).ask).toBe('EMPTY'));
});
describe('duplicates', () => {
  const ex = [{ id: '1', name: 'Maharajganj Indane' }, { id: '2', name: 'Bettiah Indane' }];
  it('flags spelling/case variants only', () => {
    expect(findDuplicates('Maharaj Ganj Indane', ex).map(d => d.id)).toEqual(['1']);
    expect(findDuplicates('MAHARAJGANJ INDANE', ex).map(d => d.id)).toEqual(['1']);
  });
});
