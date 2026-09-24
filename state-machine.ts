// Trip state machine. Pure functions only, so it is easy to test. The DB layer applies the results.
export type State = 'AT_PLANT'|'LOADED'|'ON_ROUTE_TO_AGENCY'|'AT_AGENCY'|'UNLOADING'|'EMPTY'|'RETURNING_TO_PLANT'|'AT_PLANT_WAITING_FOR_LOAD';
export type EventType = 'LOAD_TAKEN'|'AGENCY_SET'|'LEFT_PLANT'|'REACHED_AGENCY'|'UNLOADING_STARTED'|'EMPTY'|'LEFT_AGENCY'|'REACHED_PLANT'|'NEW_LOAD_TAKEN';

const T: Record<State, Partial<Record<EventType, State>>> = {
  AT_PLANT: { LOAD_TAKEN: 'LOADED' },
  LOADED: { AGENCY_SET: 'LOADED', LEFT_PLANT: 'ON_ROUTE_TO_AGENCY' },
  ON_ROUTE_TO_AGENCY: { REACHED_AGENCY: 'AT_AGENCY' },
  AT_AGENCY: { UNLOADING_STARTED: 'UNLOADING' },
  UNLOADING: { EMPTY: 'EMPTY' },
  EMPTY: { LEFT_AGENCY: 'RETURNING_TO_PLANT' },
  RETURNING_TO_PLANT: { REACHED_PLANT: 'AT_PLANT_WAITING_FOR_LOAD' },
  // Reaching the plant alone never closes a trip; only NEW_LOAD_TAKEN does (caller completes old trip + opens new).
  AT_PLANT_WAITING_FOR_LOAD: { NEW_LOAD_TAKEN: 'LOADED' },
};

export class InvalidTransition extends Error {}
export function next(state: State, ev: EventType): State {
  const to = T[state][ev];
  if (!to) throw new InvalidTransition(`${ev} not allowed in ${state}`);
  return to;
}
export const startsNewTrip = (state: State, ev: EventType) => state === 'AT_PLANT_WAITING_FOR_LOAD' && ev === 'NEW_LOAD_TAKEN';

export interface Ctx { agencyId?: string|null; agencyName?: string|null; plant?: string; expectedEmptyAt?: Date|null }
export interface Question { ask: EventType|'AGENCY'|'EXPECTED_EMPTY'; text: string; options?: string[] }

/** Context-aware: returns only the NEXT missing question; never re-asks known facts. */
export function nextQuestion(state: State, c: Ctx): Question {
  const yn = ['Yes / हाँ', 'No / नहीं'];
  switch (state) {
    case 'AT_PLANT': return { ask: 'LOAD_TAKEN', text: `Have you taken the load from ${c.plant ?? 'the plant'}?`, options: yn };
    case 'LOADED': return !c.agencyId && !c.agencyName
      ? { ask: 'AGENCY', text: 'Which agency are you going to?' }
      : { ask: 'LEFT_PLANT', text: 'Have you left the plant?', options: yn };
    case 'ON_ROUTE_TO_AGENCY': return { ask: 'REACHED_AGENCY', text: `Have you reached ${c.agencyName ?? 'the agency'}?`, options: yn };
    case 'AT_AGENCY': return { ask: 'UNLOADING_STARTED', text: 'Has unloading started?', options: yn };
    case 'UNLOADING': return !c.expectedEmptyAt
      ? { ask: 'EXPECTED_EMPTY', text: 'Expected empty time?' }
      : { ask: 'EMPTY', text: 'Are you empty now?', options: ['Yes / हाँ', 'Still unloading'] };
    case 'EMPTY': return { ask: 'LEFT_AGENCY', text: 'Have you left the agency for the plant?', options: yn };
    case 'RETURNING_TO_PLANT': return { ask: 'REACHED_PLANT', text: 'Have you reached the plant?', options: yn };
    case 'AT_PLANT_WAITING_FOR_LOAD': return { ask: 'NEW_LOAD_TAKEN', text: 'Have you taken a new load?', options: yn };
  }
}
