import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { next, nextQuestion, startsNewTrip, InvalidTransition, type State } from '@/lib/state-machine';
import { findDuplicates, normalize } from '@/lib/agency';

const db = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const Body = z.object({
  event: z.enum(['LOAD_TAKEN','AGENCY_SET','LEFT_PLANT','REACHED_AGENCY','UNLOADING_STARTED','EMPTY','LEFT_AGENCY','REACHED_PLANT','NEW_LOAD_TAKEN']),
  clientEventId: z.string().uuid(),          // makes offline retries safe
  occurredAt: z.string().datetime(),         // real time on driver's phone
  agencyId: z.string().uuid().optional(), agencyName: z.string().trim().min(2).max(120).optional(),
  expectedAt: z.string().datetime().optional(),
  lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
});

export async function POST(req: Request) {
  const sb = db();
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  const { data: u } = await sb.auth.getUser(token);
  if (!u.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  const b = p.data;

  // Authorization: a driver can only touch the vehicle assigned to them (looked up server-side, never from the request).
  const { data: driver } = await sb.from('drivers').select('id').eq('user_id', u.user.id).eq('active', true).maybeSingle();
  const { data: v } = driver
    ? await sb.from('vehicles').select('*').eq('driver_id', driver.id).eq('active', true).maybeSingle()
    : { data: null };
  if (!driver || !v) return NextResponse.json({ error: 'No active vehicle assigned' }, { status: 403 });

  const seen = await sb.from('trip_events').select('id').eq('client_event_id', b.clientEventId).maybeSingle();
  if (seen.data) return NextResponse.json({ ok: true, duplicate: true });

  const state = v.state as State;
  let tripId = v.current_trip_id as string | null, agencyId = (b.agencyId ?? v.current_agency_id) as string | null;
  try {
    const to = next(state, b.event);
    if (startsNewTrip(state, b.event) && tripId) {     // old trip COMPLETE, new trip ACTIVE
      await sb.from('trips').update({ status: 'COMPLETE', completed_at: b.occurredAt }).eq('id', tripId);
      tripId = null; agencyId = null;
    }
    if (!tripId) {
      const { data: last } = await sb.from('trips').select('trip_no').eq('vehicle_id', v.id).order('trip_no', { ascending: false }).limit(1);
      const { data: t, error } = await sb.from('trips').insert({ vehicle_id: v.id, driver_id: driver.id, plant_id: v.plant_id,
        trip_no: (last?.[0]?.trip_no ?? 0) + 1, started_at: b.occurredAt }).select('id').single();
      if (error) throw error; tripId = t.id;
    }
    // Agency: existing id, or free text -> exact-normalized match, else PENDING request (never auto-approved).
    let agencyName: string | null = null;
    if (b.agencyName && !b.agencyId) {
      const { data: all } = await sb.from('agencies').select('id,name').eq('active', true);
      const exact = all?.find(a => normalize(a.name) === normalize(b.agencyName!));
      if (exact) agencyId = exact.id;
      else await sb.from('agency_requests').insert({ submitted_name: b.agencyName, submitted_by: u.user.id, vehicle_id: v.id,
        trip_id: tripId, possible_duplicate_ids: findDuplicates(b.agencyName, all ?? []).map(d => d.id) });
      agencyName = b.agencyName;
    }
    await sb.from('trip_events').insert({ trip_id: tripId, vehicle_id: v.id, driver_id: driver.id, agency_id: agencyId,
      type: b.event, occurred_at: b.occurredAt, lat: b.lat, lng: b.lng, source: b.lat != null ? 'DRIVER_GPS' : 'DRIVER',
      notes: agencyName ? `Agency (unapproved text): ${agencyName}` : null, client_event_id: b.clientEventId });
    if (agencyId) await sb.from('trips').update({ agency_id: agencyId }).eq('id', tripId);
    const expected = b.expectedAt ?? (b.event === 'EMPTY' ? null : v.expected_empty_at);
    await sb.from('vehicles').update({ state: to, current_trip_id: tripId, current_agency_id: agencyId,
      expected_empty_at: expected, last_response_at: new Date().toISOString(), reminder_sent_at: null, no_response_since: null }).eq('id', v.id);
    const q = nextQuestion(to, { agencyId, agencyName, expectedEmptyAt: expected ? new Date(expected) : null });
    return NextResponse.json({ ok: true, state: to, tripId, nextQuestion: q });
  } catch (e) {
    if (e instanceof InvalidTransition) return NextResponse.json({ error: e.message, nextQuestion: nextQuestion(state, {}) }, { status: 409 });
    return NextResponse.json({ error: 'Temporary failure, please retry' }, { status: 503 });
  }
}
