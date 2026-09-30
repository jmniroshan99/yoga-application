import crypto from 'node:crypto';
import {Router} from 'express';
import {DateTime} from 'luxon';
import {z} from 'zod';
import {actor,allow,audit,config,fail,notify,one,pool,route,seal,staffAt,tx,unseal,type Db} from './core.js';
import {canCancel,listAvailability,type Service,type Slot} from './scheduling.js';

export const api = Router();
const uuid=z.string().uuid();
const activeStatuses=['pending_review','pending_payment','confirmed','checked_in','completed'];
type Booking = {id:string;slot_id:string;service_id:string;client_id:string;status:string;review_status:string;payment_status:string;price_cents:number;hold_expires_at:Date|null;starts_at:Date;ends_at:Date;branch_id:string;practitioner_id:string;kind:string;service_name:string;branch_name:string;timezone:string;practitioner_name:string};
const bookingSelect=`SELECT b.id,b.slot_id,sl.service_id,b.client_id,b.status,b.review_status,b.payment_status,b.price_cents,b.hold_expires_at,
  sl.starts_at,sl.ends_at,sl.branch_id,sl.practitioner_id,sl.kind,s.name AS service_name,br.name AS branch_name,
  br.timezone,u.name AS practitioner_name FROM bookings b JOIN session_slots sl ON sl.id=b.slot_id
  JOIN services s ON s.id=sl.service_id JOIN branches br ON br.id=sl.branch_id JOIN users u ON u.id=sl.practitioner_id`;

async function expireHolds(db:Db) {
  const expired=(await db.query<{slot_id:string;client_id:string}>(`UPDATE bookings SET status='cancelled',updated_at=now(),cancellation_reason='Reservation expired'
    WHERE status IN ('pending_payment','pending_review') AND hold_expires_at<now()
    RETURNING slot_id,client_id`)).rows;
  if(expired.length) await db.query("UPDATE session_slots SET status='closed' WHERE kind<>'group' AND id=ANY($1::uuid[])",[expired.map(e=>e.slot_id)]);
}
async function booking(db:Db,id:string,locked=false) {
  return one<Booking>(db,`${bookingSelect} WHERE b.id=$1 ${locked?'FOR UPDATE OF b':''}`,[id]);
}
function authorizedBooking(user:ReturnType<typeof actor>,b:Booking) {
  return b.client_id===user.id || b.practitioner_id===user.id && user.role==='practitioner' ||
    ['receptionist','manager','admin'].includes(user.role) && (user.role==='admin'||user.branch_id===b.branch_id);
}
async function assertNoClientOverlap(db:Db,clientId:string,start:string|Date,end:string|Date,except?:string) {
  // The user row is locked by callers, serializing reservations made by the same client.
  const clash=await one<{id:string}>(db,`SELECT b.id FROM bookings b JOIN session_slots sl ON sl.id=b.slot_id
    WHERE b.client_id=$1 AND b.status=ANY($4::text[]) AND (b.hold_expires_at IS NULL OR b.hold_expires_at>now())
    AND sl.starts_at<$3 AND sl.ends_at>$2 AND ($5::uuid IS NULL OR b.id<>$5) LIMIT 1`,[clientId,start,end,activeStatuses,except||null]);
  if(clash) fail(409,'CLIENT_TIME_CONFLICT','You already have a booking at this time.');
}
async function createPrivateSlot(db:Db,service:Service,branchId:string,practitionerId:string,startIso:string,roomId?:string|null) {
  const capable=await one(db,`SELECT 1 FROM service_practitioners sp JOIN users u ON u.id=sp.practitioner_id
    WHERE sp.service_id=$1 AND sp.practitioner_id=$2 AND u.active=true FOR UPDATE OF u`,[service.id,practitionerId]);
  if(!capable) fail(422,'PRACTITIONER_NOT_ELIGIBLE','Choose an available practitioner.');
  const start=DateTime.fromISO(startIso,{setZone:true});
  if(!start.isValid) fail(422,'INVALID_TIME','Choose a valid time.');
  const date=start.setZone((await one<{timezone:string}>(db,'SELECT timezone FROM branches WHERE id=$1',[branchId]))!.timezone).toISODate()!;
  const available=await listAvailability(db,service.id,branchId,date,practitionerId);
  if(!available.some(s=>'practitioner_id' in s && s.practitioner_id===practitionerId && new Date(s.starts_at).getTime()===start.toMillis()))
    fail(409,'SLOT_UNAVAILABLE','This time is no longer available. Please choose another.');
  const end=start.plus({minutes:service.duration_minutes});
  const occupiedStart=start.minus({minutes:service.buffer_minutes}).toUTC().toISO();
  const occupiedEnd=end.plus({minutes:service.buffer_minutes}).toUTC().toISO();
  let room:string|null=null;
  if(service.kind!=='online') {
    if(roomId) {
      const found=await one<{id:string}>(db,'SELECT id FROM rooms WHERE id=$1 AND branch_id=$2 AND active=true',[roomId,branchId]);
      if(!found) fail(422,'INVALID_ROOM','Choose a room at this branch.'); room=found.id;
    } else {
      room=(await one<{id:string}>(db,`SELECT r.id FROM rooms r WHERE r.branch_id=$1 AND r.active=true
        AND NOT EXISTS(SELECT 1 FROM session_slots sl WHERE sl.room_id=r.id AND sl.status='open'
        AND sl.occupied_start_at<$3 AND sl.occupied_end_at>$2)
        ORDER BY r.capacity ASC LIMIT 1`,[branchId,occupiedStart,occupiedEnd]))?.id||null;
      if(!room) fail(409,'NO_ROOM','No room is available for this time.');
    }
  }
  const inserted=await one<{id:string}>(db,`INSERT INTO session_slots(service_id,branch_id,practitioner_id,room_id,starts_at,ends_at,occupied_start_at,occupied_end_at,capacity,kind)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9) RETURNING id`,[service.id,branchId,practitionerId,room,start.toUTC().toISO(),end.toUTC().toISO(),
    occupiedStart,occupiedEnd,service.kind]);
  return {id:inserted!.id,start:start.toUTC().toISO()!,end:end.toUTC().toISO()!};
}
function dbConflict(error:unknown):never {
  if((error as {code?:string}).code==='23P01') fail(409,'RESOURCE_CONFLICT','The practitioner or room was just reserved. Choose another slot.');
  if((error as {code?:string}).code==='23505') fail(409,'DUPLICATE_BOOKING','This reservation already exists.');
  throw error;
}

api.get('/catalog',route(async(_req,res)=>{
  const services=await pool.query('SELECT id,name,summary,category,kind,duration_minutes,buffer_minutes,price_cents,capacity,requires_review,accent FROM services WHERE active=true ORDER BY price_cents');
  const practitioners=await pool.query("SELECT u.id,u.name,p.bio,p.qualifications,p.languages,u.branch_id FROM practitioners p JOIN users u ON u.id=p.user_id WHERE p.active AND u.active ORDER BY u.name");
  const branches=await pool.query('SELECT id,name,address,timezone,contact FROM branches WHERE active=true ORDER BY name');
  const rooms=await pool.query('SELECT id,branch_id,name,capacity FROM rooms WHERE active=true ORDER BY capacity');
  const packages=await pool.query('SELECT id,service_id,name,sessions,price_cents,validity_days FROM packages WHERE active=true');
  res.json({services:services.rows,practitioners:practitioners.rows,branches:branches.rows,rooms:rooms.rows,packages:packages.rows});
}));
api.get('/availability',route(async(req,res)=>{
  const input=z.object({serviceId:uuid,branchId:uuid,date:z.string().date(),practitionerId:uuid.optional()}).parse(req.query);
  await expireHolds(pool);
  res.json({slots:await listAvailability(pool,input.serviceId,input.branchId,input.date,input.practitionerId)});
}));
api.get('/intake-form',route(async(_req,res)=>{
  const form=await one(pool,'SELECT id,version,title,questions FROM intake_forms WHERE active=true ORDER BY version DESC LIMIT 1'); res.json({form});
}));

const bookInput=z.object({serviceId:uuid,branchId:uuid,practitionerId:uuid.optional(),roomId:uuid.optional(),slotId:uuid.optional(),startsAt:z.string().datetime({offset:true}).optional(),
  intake:z.record(z.string().max(2000)).optional(),consent:z.literal(true).optional(),formId:uuid.optional()});
api.post('/bookings',route(async(req,res)=>{
  const user=allow(req,['client','receptionist','manager','admin']);
  const input=bookInput.extend({clientId:uuid.optional()}).parse(req.body);
  const clientId=user.role==='client'?user.id:input.clientId;
  if(!clientId) fail(422,'CLIENT_REQUIRED','Choose a client.');
  try {
    const result=await tx(async db=>{
      await expireHolds(db);
      const client=await one<{id:string}>(db,"SELECT id FROM users WHERE id=$1 AND role='client' AND active=true FOR UPDATE",[clientId]);
      if(!client) fail(404,'CLIENT_NOT_FOUND','Client not found.');
      const service=await one<Service>(db,'SELECT * FROM services WHERE id=$1 AND active=true',[input.serviceId]);
      const branch=await one<{id:string}>(db,'SELECT id FROM branches WHERE id=$1 AND active=true',[input.branchId]);
      if(!service||!branch) fail(404,'CATALOG_NOT_FOUND','Service or branch unavailable.');
      if(user.role!=='client') staffAt(req,input.branchId);
      let slotId:string,start:string|Date,end:string|Date,practitionerId:string;
      if(service.kind==='group') {
        if(!input.slotId) fail(422,'SLOT_REQUIRED','Choose a class.');
        const slot=await one<Slot>(db,"SELECT * FROM session_slots WHERE id=$1 AND service_id=$2 AND branch_id=$3 AND status='open' FOR UPDATE",[input.slotId,service.id,input.branchId]);
        if(!slot||new Date(slot.starts_at).getTime()<=Date.now()+30*60000) fail(409,'SLOT_UNAVAILABLE','This class is unavailable.');
        const current=await one<{count:number}>(db,`SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1
          AND status=ANY($2::text[]) AND (hold_expires_at IS NULL OR hold_expires_at>now())`,[slot.id,activeStatuses]);
        if(current!.count>=slot.capacity) fail(409,'CLASS_FULL','This class is full.');
        slotId=slot.id; start=slot.starts_at;end=slot.ends_at;practitionerId=slot.practitioner_id;
      } else {
        if(!input.practitionerId||!input.startsAt) fail(422,'SLOT_REQUIRED','Choose a practitioner and time.');
        const slot=await createPrivateSlot(db,service,input.branchId,input.practitionerId,input.startsAt,input.roomId);
        slotId=slot.id;start=slot.start;end=slot.end;practitionerId=input.practitionerId;
      }
      await assertNoClientOverlap(db,clientId,start,end);
      if(service.requires_review && (!input.consent||!input.formId||!input.intake)) fail(422,'INTAKE_REQUIRED','Complete the intake and consent form.');
      const state=service.requires_review?'pending_review':'pending_payment';
      const expires=service.requires_review?`${config.reviewHours} hours`:`${config.holdMinutes} minutes`;
      const created=await one<{id:string}>(db,`INSERT INTO bookings(slot_id,client_id,status,review_status,price_cents,hold_expires_at)
        VALUES($1,$2,$3,$4,$5,now()+$6::interval) RETURNING id`,
        [slotId,clientId,state,service.requires_review?'pending':'not_required',service.price_cents,expires]);
      if(service.requires_review) {
        const form=await one<{id:string;questions:{key:string;required:boolean}[]}>(db,'SELECT id,questions FROM intake_forms WHERE id=$1 AND active=true',[input.formId]);
        if(!form) fail(422,'FORM_VERSION','Refresh the intake form.');
        if(form.questions.some(q=>q.required&&!input.intake?.[q.key]?.trim())||Object.keys(input.intake||{}).some(key=>!form.questions.some(q=>q.key===key)))
          fail(422,'INTAKE_INVALID','Complete the required intake questions.');
        await db.query('INSERT INTO intake_responses(booking_id,form_id,ciphertext) VALUES($1,$2,$3)',[created!.id,form.id,seal(input.intake)]);
        await db.query('INSERT INTO consent_records(booking_id,client_id,policy_version) VALUES($1,$2,$3)',[created!.id,clientId,'2026-09']);
        await notify(db,practitionerId,'intake_review',{bookingId:created!.id});
      }
      await db.query('INSERT INTO booking_events(booking_id,actor_id,action) VALUES($1,$2,$3)',[created!.id,user.id,'created']);
      await notify(db,clientId,state==='pending_review'?'review_requested':'payment_needed',{bookingId:created!.id});
      await audit(db,user.id,'booking_created','booking',created!.id,{state});
      return booking(db,created!.id);
    });
    res.status(201).json({booking:result});
  } catch(error) {dbConflict(error);}
}));
api.get('/bookings',route(async(req,res)=>{
  const user=actor(req);
  await expireHolds(pool);
  const where=user.role==='client'?'b.client_id=$1':user.role==='practitioner'?'sl.practitioner_id=$1':user.role==='admin'?'TRUE':'sl.branch_id=$1';
  const params=user.role==='admin'?[]:[user.role==='client'||user.role==='practitioner'?user.id:user.branch_id];
  const rows=(await pool.query(`${bookingSelect} WHERE ${where} ORDER BY sl.starts_at DESC LIMIT 100`,params)).rows;
  res.json({bookings:rows});
}));
api.get('/bookings/:id',route(async(req,res)=>{
  const user=actor(req),id=uuid.parse(req.params.id);const b=await booking(pool,id);
  if(!b||!authorizedBooking(user,b)) fail(404,'BOOKING_NOT_FOUND','Booking not found.');
  res.json({booking:b});
}));
api.get('/bookings/:id/intake',route(async(req,res)=>{
  const user=actor(req),b=await booking(pool,uuid.parse(req.params.id));
  if(!b||!(b.client_id===user.id || b.practitioner_id===user.id && user.role==='practitioner')) fail(404,'INTAKE_NOT_FOUND','Intake not found.');
  const data=await one<{ciphertext:string;questions:unknown;version:number}>(pool,`SELECT i.ciphertext,f.questions,f.version FROM intake_responses i JOIN intake_forms f ON f.id=i.form_id WHERE i.booking_id=$1`,[b.id]);
  if(!data) fail(404,'INTAKE_NOT_FOUND','Intake not found.');
  await audit(pool,user.id,'intake_read','booking',b.id);
  res.json({answers:unseal(data.ciphertext),questions:data.questions,version:data.version});
}));
api.post('/bookings/:id/review',route(async(req,res)=>{
  const user=allow(req,['practitioner']),id=uuid.parse(req.params.id);
  const input=z.object({decision:z.enum(['approved','declined','more_information']),comment:z.string().max(2000).optional()}).parse(req.body);
  const result=await tx(async db=>{
    const b=await booking(db,id,true);
    if(!b||b.practitioner_id!==user.id) fail(404,'BOOKING_NOT_FOUND','Assigned booking not found.');
    if(b.status!=='pending_review'||b.review_status!=='pending') fail(409,'REVIEW_CLOSED','This review is no longer pending.');
    const state=input.decision==='approved'?'pending_payment':input.decision==='declined'?'cancelled':'pending_review';
    await db.query(`UPDATE bookings SET status=$2,review_status=$3,hold_expires_at=CASE WHEN $3='approved' THEN now()+$4::interval
      WHEN $3='declined' THEN NULL ELSE now()+$5::interval END,updated_at=now() WHERE id=$1`,[id,state,input.decision,`${config.holdMinutes} minutes`,`${config.reviewHours} hours`]);
    if(input.decision==='declined') await db.query("UPDATE session_slots SET status='closed' WHERE id=$1 AND kind<>'group'",[b.slot_id]);
    await db.query('INSERT INTO practitioner_reviews(booking_id,practitioner_id,decision,comment_ciphertext) VALUES($1,$2,$3,$4)',[id,user.id,input.decision,input.comment?seal(input.comment):null]);
    await notify(db,b.client_id,'review_'+input.decision,{bookingId:id});
    await audit(db,user.id,'intake_reviewed','booking',id,{decision:input.decision});return booking(db,id);
  });res.json({booking:result});
}));
api.post('/bookings/:id/pay',route(async(req,res)=>{
  const user=actor(req),id=uuid.parse(req.params.id);
  const input=z.object({idempotencyKey:z.string().uuid()}).parse(req.body);
  if(!config.sandbox) fail(503,'PAYMENT_PROVIDER_REQUIRED','No live payment provider is configured.');
  const result=await tx(async db=>{
    const b=await booking(db,id,true);
    if(!b||b.client_id!==user.id) fail(404,'BOOKING_NOT_FOUND','Booking not found.');
    if(b.payment_status==='paid') return booking(db,id);
    if(b.status!=='pending_payment'||!b.hold_expires_at||new Date(b.hold_expires_at).getTime()<Date.now()) fail(409,'PAYMENT_WINDOW_CLOSED','Payment time expired. Choose a new slot.');
    const existing=await one<{id:string;booking_id:string}>(db,'SELECT id,booking_id FROM payments WHERE idempotency_key=$1',[input.idempotencyKey]);
    if(existing&&existing.booking_id!==id) fail(409,'IDEMPOTENCY_CONFLICT','Payment request key was reused.');
    const payment=existing||await one<{id:string}>(db,"INSERT INTO payments(booking_id,amount_cents,provider,status,idempotency_key) VALUES($1,$2,'sandbox','pending',$3) RETURNING id",[id,b.price_cents,input.idempotencyKey]);
    const eventId=`sandbox-paid-${payment!.id}`;
    const event=await db.query('INSERT INTO payment_events(event_id,payment_id,event_type) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id',[eventId,payment!.id,'paid']);
    if(event.rowCount) {
      await db.query("UPDATE payments SET status='paid',updated_at=now() WHERE id=$1",[payment!.id]);
      await db.query("UPDATE bookings SET status='confirmed',payment_status='paid',hold_expires_at=NULL,updated_at=now() WHERE id=$1",[id]);
      await db.query('INSERT INTO invoices(booking_id,amount_cents) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,b.price_cents]);
      await notify(db,b.client_id,'booking_confirmed',{bookingId:id});
      await audit(db,user.id,'sandbox_payment_completed','booking',id,{paymentId:payment!.id});
    }
    return booking(db,id);
  });res.json({booking:result,sandbox:true});
}));
api.post('/bookings/:id/cancel',route(async(req,res)=>{
  const user=actor(req),id=uuid.parse(req.params.id);
  const result=await tx(async db=>{
    const b=await booking(db,id,true);
    if(!b||!authorizedBooking(user,b)) fail(404,'BOOKING_NOT_FOUND','Booking not found.');
    if(!['pending_review','pending_payment','confirmed'].includes(b.status)) fail(409,'CANNOT_CANCEL','This booking cannot be cancelled.');
    if(user.role==='client'&&!canCancel(b.starts_at,config.cancellationHours)) fail(409,'CANCELLATION_WINDOW','Contact the studio for a late cancellation.');
    if(user.role!=='client'&&user.role!=='practitioner') staffAt(req,b.branch_id);
    if(user.role==='practitioner') fail(403,'FORBIDDEN','Contact the studio to cancel a client booking.');
    await db.query("UPDATE bookings SET status='cancelled',updated_at=now(),hold_expires_at=NULL WHERE id=$1",[id]);
    if(b.kind!=='group') await db.query("UPDATE session_slots SET status='closed' WHERE id=$1",[b.slot_id]);
    if(b.payment_status==='paid'&&config.sandbox) {
      const refunded=await db.query("UPDATE payments SET status='refunded',updated_at=now() WHERE booking_id=$1 AND status='paid' AND provider='sandbox' RETURNING id",[id]);
      if(refunded.rowCount) await db.query("UPDATE bookings SET payment_status='refunded' WHERE id=$1",[id]);
    }
    await db.query('INSERT INTO booking_events(booking_id,actor_id,action) VALUES($1,$2,$3)',[id,user.id,'cancelled']);
    await notify(db,b.client_id,'booking_cancelled',{bookingId:id});
    await audit(db,user.id,'booking_cancelled','booking',id);return booking(db,id);
  });res.json({booking:result});
}));
api.post('/bookings/:id/reschedule',route(async(req,res)=>{
  const user=actor(req),id=uuid.parse(req.params.id);
  const input=z.object({startsAt:z.string().datetime({offset:true}),branchId:uuid,practitionerId:uuid,roomId:uuid.optional()}).parse(req.body);
  try {
    const result=await tx(async db=>{
      const b=await booking(db,id,true);if(!b||b.client_id!==user.id) fail(404,'BOOKING_NOT_FOUND','Booking not found.');
      if(b.kind==='group') fail(422,'GROUP_RESCHEDULE','Cancel the class and select a new class.');
      if(b.status!=='confirmed'||!canCancel(b.starts_at,config.cancellationHours)) fail(409,'RESCHEDULE_WINDOW','Rescheduling is unavailable for this booking.');
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[b.client_id]);
      const service=await one<Service>(db,'SELECT s.* FROM services s JOIN session_slots sl ON sl.service_id=s.id WHERE sl.id=$1',[b.slot_id]);
      if(service!.requires_review&&input.practitionerId!==b.practitioner_id)
        fail(422,'NEW_PRACTITIONER_REVIEW','A therapeutic session must stay with its reviewing practitioner. Contact the studio to change practitioners.');
      // The old allocation is released inside this transaction. Rollback restores it if the new time fails.
      await db.query("UPDATE session_slots SET status='closed' WHERE id=$1",[b.slot_id]);
      const newSlot=await createPrivateSlot(db,service!,input.branchId,input.practitionerId,input.startsAt,input.roomId);
      await assertNoClientOverlap(db,b.client_id,newSlot.start,newSlot.end,b.id);
      await db.query('UPDATE bookings SET slot_id=$2,updated_at=now() WHERE id=$1',[b.id,newSlot.id]);
      await db.query('INSERT INTO booking_events(booking_id,actor_id,action,details) VALUES($1,$2,$3,$4)',[b.id,user.id,'rescheduled',{previousSlotId:b.slot_id,newSlotId:newSlot.id}]);
      await notify(db,b.client_id,'booking_rescheduled',{bookingId:id});return booking(db,id);
    });res.json({booking:result});
  } catch(error) {dbConflict(error);}
}));
api.get('/bookings/:id/calendar.ics',route(async(req,res)=>{
  const user=actor(req),b=await booking(pool,uuid.parse(req.params.id));
  if(!b||!authorizedBooking(user,b)) fail(404,'BOOKING_NOT_FOUND','Booking not found.');
  const stamp=(d:Date)=>DateTime.fromJSDate(new Date(d)).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const escape=(s:string)=>s.replace(/[\\;,]/g,'\\$&').replace(/\n/g,'\\n');
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Sahana//Booking//EN','BEGIN:VEVENT',`UID:${b.id}@sahana.local`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(b.starts_at)}`,`DTEND:${stamp(b.ends_at)}`,`SUMMARY:${escape(b.service_name)}`,`LOCATION:${escape(b.branch_name)}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
  res.setHeader('Content-Type','text/calendar; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="booking-${b.id}.ics"`);res.send(ics);
}));

api.patch('/bookings/:id/intake',route(async(req,res)=>{
  const user=allow(req,['client']),id=uuid.parse(req.params.id);
  const input=z.object({answers:z.record(z.string().max(2000)),consent:z.literal(true)}).parse(req.body);
  await tx(async db=>{
    const b=await booking(db,id,true);
    if(!b||b.client_id!==user.id) fail(404,'BOOKING_NOT_FOUND','Booking not found.');
    if(b.review_status!=='more_information'||b.status!=='pending_review') fail(409,'INTAKE_LOCKED','The intake is not awaiting an update.');
    const form=await one<{questions:{key:string;required:boolean}[]}>(db,'SELECT f.questions FROM intake_forms f JOIN intake_responses i ON i.form_id=f.id WHERE i.booking_id=$1',[id]);
    if(!form||form.questions.some(q=>q.required&&!input.answers[q.key]?.trim())) fail(422,'INTAKE_INVALID','Complete the required intake questions.');
    await db.query('UPDATE intake_responses SET ciphertext=$2,submitted_at=now() WHERE booking_id=$1',[id,seal(input.answers)]);
    await db.query("UPDATE bookings SET review_status='pending',hold_expires_at=now()+$2::interval,updated_at=now() WHERE id=$1",[id,`${config.reviewHours} hours`]);
    await db.query('UPDATE consent_records SET agreed_at=now() WHERE booking_id=$1',[id]);
    await notify(db,b.practitioner_id,'intake_review',{bookingId:id});await audit(db,user.id,'intake_updated','booking',id);
  });res.json({ok:true});
}));

api.get('/notifications',route(async(req,res)=>{
  const user=actor(req);
  const notifications=(await pool.query(`SELECT id,template,payload,created_at,status FROM notification_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,[user.id])).rows;
  res.json({notifications});
}));
api.post('/waitlist',route(async(req,res)=>{
  const user=allow(req,['client']);
  const input=z.object({serviceId:uuid,branchId:uuid,date:z.string().date()}).parse(req.body);
  const row=await one<{id:string}>(pool,`INSERT INTO waitlist_entries(service_id,branch_id,client_id,desired_date)
    VALUES($1,$2,$3,$4) ON CONFLICT(service_id,client_id,desired_date,branch_id)
    DO UPDATE SET status='waiting' RETURNING id`,[input.serviceId,input.branchId,user.id,input.date]);
  res.status(201).json({id:row!.id});
}));

api.get('/staff/overview',route(async(req,res)=>{
  const user=allow(req,['practitioner','receptionist','manager','admin']);
  const clause=user.role==='admin'?'TRUE':user.role==='practitioner'?'sl.practitioner_id=$1':'sl.branch_id=$1';
  const params=user.role==='admin'?[]:[user.role==='practitioner'?user.id:user.branch_id];
  const [upcoming,reviews]=await Promise.all([
    pool.query(`${bookingSelect} WHERE ${clause} AND sl.starts_at>now() AND b.status<>'cancelled' ORDER BY sl.starts_at LIMIT 80`,params),
    pool.query(`${bookingSelect} WHERE ${clause} AND b.status='pending_review' AND b.review_status='pending' ORDER BY b.booked_at LIMIT 80`,params)
  ]);
  res.json({upcoming:upcoming.rows,reviews:reviews.rows});
}));
api.post('/staff/bookings/:id/status',route(async(req,res)=>{
  const user=allow(req,['practitioner','receptionist','manager','admin']),id=uuid.parse(req.params.id);
  const input=z.object({action:z.enum(['check_in','complete','no_show'])}).parse(req.body);
  const result=await tx(async db=>{
    const b=await booking(db,id,true);
    if(!b||!authorizedBooking(user,b)) fail(404,'BOOKING_NOT_FOUND','Booking not found.');
    const expected=input.action==='check_in'?'confirmed':input.action==='complete'?'checked_in':'confirmed';
    if(b.status!==expected) fail(409,'INVALID_TRANSITION',`Expected ${expected} booking.`);
    if(input.action==='check_in'&&(new Date(b.starts_at).getTime()-Date.now()>2*3600000||Date.now()-new Date(b.ends_at).getTime()>2*3600000))
      fail(409,'CHECKIN_WINDOW','Check-in is allowed from two hours before until two hours after the session.');
    if(input.action==='no_show'&&new Date(b.ends_at).getTime()>Date.now()) fail(409,'SESSION_NOT_ENDED','Mark no-show after the session ends.');
    const target=input.action==='check_in'?'checked_in':input.action==='complete'?'completed':'no_show';
    await db.query('UPDATE bookings SET status=$2,updated_at=now() WHERE id=$1',[id,target]);
    await db.query('INSERT INTO booking_events(booking_id,actor_id,action) VALUES($1,$2,$3)',[id,user.id,target]);
    await audit(db,user.id,target,'booking',id);return booking(db,id);
  });res.json({booking:result});
}));
api.get('/staff/bookings/:id/notes',route(async(req,res)=>{
  const user=allow(req,['practitioner']),b=await booking(pool,uuid.parse(req.params.id));
  if(!b||b.practitioner_id!==user.id) fail(404,'BOOKING_NOT_FOUND','Assigned booking not found.');
  const row=await one<{ciphertext:string}>(pool,'SELECT ciphertext FROM session_notes WHERE booking_id=$1',[b.id]);
  await audit(pool,user.id,'session_note_read','booking',b.id);
  res.json({notes:row?unseal(row.ciphertext):null});
}));
api.put('/staff/bookings/:id/notes',route(async(req,res)=>{
  const user=allow(req,['practitioner']),id=uuid.parse(req.params.id);
  const input=z.object({notes:z.string().min(1).max(10000)}).parse(req.body);
  const b=await booking(pool,id);
  if(!b||b.practitioner_id!==user.id) fail(404,'BOOKING_NOT_FOUND','Assigned booking not found.');
  await tx(async db=>{
    await db.query(`INSERT INTO session_notes(booking_id,practitioner_id,ciphertext) VALUES($1,$2,$3)
      ON CONFLICT(booking_id) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=now()`,[id,user.id,seal(input.notes)]);
    await audit(db,user.id,'session_note_saved','booking',id);
  });res.json({ok:true});
}));
api.post('/staff/bookings/:id/offline-payment',route(async(req,res)=>{
  const user=allow(req,['receptionist','manager','admin']),id=uuid.parse(req.params.id);
  const input=z.object({method:z.enum(['cash','bank_transfer']),reference:z.string().max(100).optional()}).parse(req.body);
  const result=await tx(async db=>{
    const b=await booking(db,id,true);if(!b) fail(404,'BOOKING_NOT_FOUND','Booking not found.');staffAt(req,b.branch_id);
    if(b.status!=='pending_payment'||!b.hold_expires_at||new Date(b.hold_expires_at).getTime()<Date.now()) fail(409,'PAYMENT_WINDOW_CLOSED','Reservation expired.');
    const payment=await one<{id:string}>(db,'INSERT INTO payments(booking_id,amount_cents,provider,status,idempotency_key,external_reference) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [id,b.price_cents,input.method,'paid',crypto.randomUUID(),input.reference||null]);
    await db.query("UPDATE bookings SET status='confirmed',payment_status='paid',hold_expires_at=NULL,updated_at=now() WHERE id=$1",[id]);
    await db.query('INSERT INTO invoices(booking_id,amount_cents) VALUES($1,$2)',[id,b.price_cents]);
    await notify(db,b.client_id,'booking_confirmed',{bookingId:id});
    await audit(db,user.id,'offline_payment_recorded','booking',id,{method:input.method,paymentId:payment!.id});return booking(db,id);
  });res.json({booking:result});
}));
api.post('/staff/time-off',route(async(req,res)=>{
  const user=allow(req,['practitioner','manager','admin']);
  const input=z.object({practitionerId:uuid,startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),reason:z.string().max(120)}).parse(req.body);
  if(user.role==='practitioner'&&user.id!==input.practitionerId) fail(403,'FORBIDDEN','Only your own availability can be changed.');
  if(new Date(input.endsAt)<=new Date(input.startsAt)) fail(422,'INVALID_RANGE','End must follow start.');
  const result=await tx(async db=>{
    const p=await one<{branch_id:string}>(db,"SELECT branch_id FROM users WHERE id=$1 AND role='practitioner' FOR UPDATE",[input.practitionerId]);
    if(!p) fail(404,'PRACTITIONER_NOT_FOUND','Practitioner not found.');
    if(user.role!=='practitioner') staffAt(req,p.branch_id);
    const conflict=(await db.query(`SELECT sl.id FROM session_slots sl
      WHERE sl.practitioner_id=$1 AND sl.occupied_start_at<$3 AND sl.occupied_end_at>$2 AND sl.status='open'`,
      [input.practitionerId,input.startsAt,input.endsAt])).rows;
    if(conflict.length) fail(409,'TIME_OFF_CONFLICT',`There are ${conflict.length} existing reservation(s) in this range.`);
    const row=await one<{id:string}>(db,'INSERT INTO availability_exceptions(practitioner_id,starts_at,ends_at,reason) VALUES($1,$2,$3,$4) RETURNING id',
      [input.practitionerId,input.startsAt,input.endsAt,input.reason]);
    await audit(db,user.id,'time_off_created','availability_exception',row!.id);
    return row;
  });res.status(201).json({timeOff:result});
}));
api.post('/staff/classes',route(async(req,res)=>{
  const user=allow(req,['manager','admin']);
  const input=z.object({serviceId:uuid,branchId:uuid,practitionerId:uuid,roomId:uuid.optional(),
    startsAt:z.string().datetime({offset:true}).optional(),localStart:z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/).optional()})
    .refine(value=>Boolean(value.startsAt)!==Boolean(value.localStart),'Provide one start time.').parse(req.body);
  staffAt(req,input.branchId);
  try {
    const result=await tx(async db=>{
      const service=await one<Service>(db,"SELECT * FROM services WHERE id=$1 AND active=true AND kind='group'",[input.serviceId]);
      if(!service) fail(404,'SERVICE_NOT_FOUND','Group service not found.');
      const capable=await one(db,'SELECT 1 FROM service_practitioners WHERE service_id=$1 AND practitioner_id=$2',[service.id,input.practitionerId]);
      if(!capable) fail(422,'PRACTITIONER_NOT_ELIGIBLE','Choose an assigned practitioner.');
      const practitioner=await one(db,`SELECT u.id FROM users u JOIN practitioners p ON p.user_id=u.id
        WHERE u.id=$1 AND u.branch_id=$2 AND u.active AND p.active FOR UPDATE OF u`,[input.practitionerId,input.branchId]);
      if(!practitioner) fail(422,'PRACTITIONER_NOT_ELIGIBLE','Choose an active practitioner at this branch.');
      const branch=await one<{timezone:string}>(db,'SELECT timezone FROM branches WHERE id=$1 AND active=true',[input.branchId]);
      if(!branch) fail(422,'INVALID_BRANCH','Choose an active branch.');
      const start=input.localStart?DateTime.fromISO(input.localStart,{zone:branch.timezone}):DateTime.fromISO(input.startsAt!,{setZone:true});
      if(!start.isValid||input.localStart&&start.toFormat("yyyy-MM-dd'T'HH:mm")!==input.localStart||start.toMillis()<Date.now()+30*60000)
        fail(422,'INVALID_TIME','Choose a valid future time in the branch timezone.');
      if(start.toMillis()>Date.now()+90*86400000) fail(422,'BOOKING_HORIZON','Choose a class within the next 90 days.');
      const end=start.plus({minutes:service.duration_minutes});
      const unavailable=await one(db,'SELECT 1 FROM availability_exceptions WHERE practitioner_id=$1 AND starts_at<$3 AND ends_at>$2 LIMIT 1',
        [input.practitionerId,start.minus({minutes:service.buffer_minutes}).toUTC().toISO(),end.plus({minutes:service.buffer_minutes}).toUTC().toISO()]);
      if(unavailable) fail(409,'PRACTITIONER_UNAVAILABLE','This practitioner is unavailable during the requested class.');
      const room=input.roomId||null;
      if(room) {
        const valid=await one(db,'SELECT 1 FROM rooms WHERE id=$1 AND branch_id=$2 AND capacity>=$3 AND active=true',[room,input.branchId,service.capacity]);
        if(!valid) fail(422,'INVALID_ROOM','Room capacity or branch is invalid.');
      }
      const row=await one<{id:string}>(db,`INSERT INTO session_slots(service_id,branch_id,practitioner_id,room_id,starts_at,ends_at,occupied_start_at,occupied_end_at,capacity,kind)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'group') RETURNING id`,[service.id,input.branchId,input.practitionerId,room,start.toUTC().toISO(),end.toUTC().toISO(),
        start.minus({minutes:service.buffer_minutes}).toUTC().toISO(),end.plus({minutes:service.buffer_minutes}).toUTC().toISO(),service.capacity]);
      await audit(db,user.id,'class_created','session_slot',row!.id);return row;
    });res.status(201).json({session:result});
  } catch(error) {dbConflict(error);}
}));
api.get('/staff/reports',route(async(req,res)=>{
  const user=allow(req,['manager','admin']);
  const branchId=user.role==='admin'?z.string().uuid().optional().parse(req.query.branchId):user.branch_id;
  const params=[branchId||null];
  const totals=await one(pool,`SELECT count(*) FILTER(WHERE b.status='confirmed')::int AS confirmed,
    count(*) FILTER(WHERE b.status='completed')::int AS completed,
    count(*) FILTER(WHERE b.status='cancelled')::int AS cancelled,
    count(*) FILTER(WHERE b.status='no_show')::int AS no_show,
    coalesce(sum(b.price_cents) FILTER(WHERE b.payment_status='paid'),0)::bigint AS revenue_cents
    FROM bookings b JOIN session_slots sl ON sl.id=b.slot_id WHERE ($1::uuid IS NULL OR sl.branch_id=$1)`,params);
  const byService=(await pool.query(`SELECT s.name,count(b.id)::int AS bookings FROM bookings b
    JOIN session_slots sl ON sl.id=b.slot_id JOIN services s ON s.id=sl.service_id
    WHERE ($1::uuid IS NULL OR sl.branch_id=$1) AND b.status<>'cancelled' GROUP BY s.name ORDER BY bookings DESC`,params)).rows;
  res.json({totals,byService});
}));
api.get('/staff/audit',route(async(req,res)=>{
  allow(req,['admin']);
  res.json({events:(await pool.query('SELECT id,actor_id,action,entity_type,entity_id,metadata,created_at FROM audit_events ORDER BY created_at DESC LIMIT 100')).rows});
}));
api.post('/staff/incidents',route(async(req,res)=>{
  const user=allow(req,['practitioner','manager','admin']);
  const input=z.object({bookingId:uuid,description:z.string().min(10).max(5000)}).parse(req.body);
  const b=await booking(pool,input.bookingId);
  if(!b||!authorizedBooking(user,b)) fail(404,'BOOKING_NOT_FOUND','Booking not found.');
  const row=await one<{id:string}>(pool,'INSERT INTO incident_reports(booking_id,reporter_id,ciphertext) VALUES($1,$2,$3) RETURNING id',[b.id,user.id,seal(input.description)]);
  await audit(pool,user.id,'incident_reported','incident_report',row!.id);
  res.status(201).json({id:row!.id});
}));
