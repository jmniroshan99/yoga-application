import {DateTime} from 'luxon';
import {type Db, fail, one} from './core.js';

export type Service = {id:string;name:string;summary:string;category:string;kind:'private'|'group'|'online';duration_minutes:number;buffer_minutes:number;price_cents:number;capacity:number;requires_review:boolean;accent:string};
export type Slot = {id:string;service_id:string;branch_id:string;practitioner_id:string;room_id:string|null;starts_at:Date;ends_at:Date;capacity:number;kind:string;status:string};
export type Branch = {id:string;name:string;timezone:string;address:string};
export function localBounds(date:string, zone:string) {
  const day=DateTime.fromISO(date,{zone});
  if (!day.isValid || day.toISODate()!==date) fail(422,'INVALID_DATE','Choose a valid date.');
  return {start:day.startOf('day').toUTC().toISO()!,end:day.plus({days:1}).startOf('day').toUTC().toISO()!};
}
export async function listAvailability(db:Db, serviceId:string, branchId:string, date:string, practitionerId?:string) {
  const service=await one<Service>(db,'SELECT * FROM services WHERE id=$1 AND active=true',[serviceId]);
  const branch=await one<Branch>(db,'SELECT id,name,timezone,address FROM branches WHERE id=$1 AND active=true',[branchId]);
  if (!service || !branch) fail(404,'CATALOG_NOT_FOUND','Service or branch not found.');
  const bounds=localBounds(date,branch.timezone);
  if (DateTime.fromISO(date,{zone:branch.timezone}).startOf('day') > DateTime.now().setZone(branch.timezone).plus({days:90})) fail(422,'BOOKING_HORIZON','Choose a date within the next 90 days.');
  if(service.kind==='group') {
    const rows=(await db.query(`SELECT sl.id,sl.starts_at,sl.ends_at,sl.practitioner_id,u.name AS practitioner_name,sl.capacity,
      count(b.id)::int AS reserved FROM session_slots sl JOIN users u ON u.id=sl.practitioner_id
      LEFT JOIN bookings b ON b.slot_id=sl.id AND b.status IN ('pending_review','pending_payment','confirmed','checked_in','completed')
      AND (b.hold_expires_at IS NULL OR b.hold_expires_at>now())
      WHERE sl.service_id=$1 AND sl.branch_id=$2 AND sl.status='open' AND sl.starts_at>now()
      AND sl.starts_at >= $3 AND sl.starts_at < $4 AND ($5::uuid IS NULL OR sl.practitioner_id=$5)
      GROUP BY sl.id,u.name ORDER BY sl.starts_at`,[serviceId,branchId,bounds.start,bounds.end,practitionerId||null])).rows;
    return rows.filter(r=>r.reserved<r.capacity).map(r=>({...r,remaining:r.capacity-r.reserved}));
  }
  const rules=(await db.query<{practitioner_id:string;practitioner_name:string;start_time:string;end_time:string}>(`SELECT a.practitioner_id,u.name AS practitioner_name,a.start_time::text,a.end_time::text
    FROM availability_rules a JOIN users u ON u.id=a.practitioner_id JOIN practitioners p ON p.user_id=a.practitioner_id
    JOIN service_practitioners sp ON sp.practitioner_id=a.practitioner_id AND sp.service_id=$1
    WHERE a.branch_id=$2 AND a.weekday=$3 AND u.active AND p.active AND ($4::uuid IS NULL OR a.practitioner_id=$4)
    ORDER BY u.name`,[serviceId,branchId,DateTime.fromISO(date,{zone:branch.timezone}).weekday%7,practitionerId||null])).rows;
  const occupied=(await db.query<{practitioner_id:string;occupied_start_at:Date;occupied_end_at:Date}>(`SELECT practitioner_id,occupied_start_at,occupied_end_at FROM session_slots
    WHERE status='open' AND occupied_start_at<$2 AND occupied_end_at>$1`,[bounds.start,bounds.end])).rows;
  const blocked=(await db.query<{practitioner_id:string;starts_at:Date;ends_at:Date}>(`SELECT practitioner_id,starts_at,ends_at FROM availability_exceptions WHERE starts_at<$2 AND ends_at>$1`,[bounds.start,bounds.end])).rows;
  const result:{starts_at:string;ends_at:string;practitioner_id:string;practitioner_name:string}[]=[];
  for(const rule of rules) {
    const open=DateTime.fromISO(`${date}T${rule.start_time}`,{zone:branch.timezone});
    const close=DateTime.fromISO(`${date}T${rule.end_time}`,{zone:branch.timezone});
    for(let start=open;start.plus({minutes:service.duration_minutes})<=close;start=start.plus({minutes:30})) {
      const end=start.plus({minutes:service.duration_minutes});
      const rangeStart=start.minus({minutes:service.buffer_minutes}).toMillis(),rangeEnd=end.plus({minutes:service.buffer_minutes}).toMillis();
      if(start.toMillis()<Date.now()+30*60000) continue;
      if(occupied.some(s=>s.practitioner_id===rule.practitioner_id && rangeStart<new Date(s.occupied_end_at).getTime() && rangeEnd>new Date(s.occupied_start_at).getTime())) continue;
      if(blocked.some(s=>s.practitioner_id===rule.practitioner_id && rangeStart<new Date(s.ends_at).getTime() && rangeEnd>new Date(s.starts_at).getTime())) continue;
      result.push({starts_at:start.toUTC().toISO()!,ends_at:end.toUTC().toISO()!,practitioner_id:rule.practitioner_id,practitioner_name:rule.practitioner_name});
    }
  }
  return result.sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
}
export function canCancel(starts:Date, cancellationHours:number, now=Date.now()) {
  return new Date(starts).getTime()-now>=cancellationHours*3600000;
}
export function nextBookingState(reviewRequired:boolean):'pending_review'|'pending_payment' {return reviewRequired?'pending_review':'pending_payment';}
