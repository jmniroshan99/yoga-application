import bcrypt from 'bcryptjs';
import {Router} from 'express';
import {z} from 'zod';
import {allow,audit,fail,one,pool,route,tx} from './core.js';

export const adminRouter=Router();
const uuid=z.string().uuid();
const weekday=z.number().int().min(0).max(6);
const clock=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Use a 24-hour time (HH:mm).');
const role=z.enum(['client','practitioner','receptionist','manager','admin']);
const admin= (req:Parameters<typeof allow>[0])=>allow(req,['admin']);

const scheduleInput=z.object({practitionerId:uuid,branchId:uuid,weekday,startTime:clock,endTime:clock});
async function lockPractitioner(db:Parameters<Parameters<typeof tx>[0]>[0],practitionerId:string,branchId:string) {
  const practitioner=await one(db,`SELECT u.id FROM users u JOIN practitioners p ON p.user_id=u.id
    JOIN branches br ON br.id=u.branch_id WHERE u.id=$1 AND u.branch_id=$2 AND u.role='practitioner'
    AND u.active AND p.active AND br.active FOR UPDATE OF u`,[practitionerId,branchId]);
  if(!practitioner) fail(422,'PRACTITIONER_NOT_ELIGIBLE','Choose an active practitioner at this branch.');
}
async function ensureNoOverlap(db:Parameters<Parameters<typeof tx>[0]>[0],practitionerId:string,branchId:string,day:number,start:string,end:string,except?:string) {
  if(start>=end) fail(422,'INVALID_HOURS','Closing time must follow opening time.');
  const overlapping=await one(db,`SELECT id FROM availability_rules WHERE practitioner_id=$1 AND branch_id=$2
    AND weekday=$3 AND start_time<$5::time AND end_time>$4::time AND ($6::uuid IS NULL OR id<>$6) LIMIT 1`,
    [practitionerId,branchId,day,start,end,except||null]);
  if(overlapping) fail(409,'SCHEDULE_OVERLAP','These hours overlap an existing schedule. Edit the existing row instead.');
}

adminRouter.get('/schedules',route(async(req,res)=>{
  admin(req);
  const rules=(await pool.query(`SELECT a.id,a.practitioner_id,a.branch_id,a.weekday,
    to_char(a.start_time,'HH24:MI') AS start_time,to_char(a.end_time,'HH24:MI') AS end_time,
    u.name AS practitioner_name,br.name AS branch_name
    FROM availability_rules a JOIN users u ON u.id=a.practitioner_id JOIN branches br ON br.id=a.branch_id
    ORDER BY br.name,u.name,a.weekday,a.start_time`)).rows;
  const classes=(await pool.query(`SELECT sl.id,sl.service_id,sl.practitioner_id,sl.branch_id,sl.room_id,
    sl.starts_at,sl.ends_at,sl.capacity,sl.status,s.name AS service_name,u.name AS practitioner_name,
    br.name AS branch_name,br.timezone,r.name AS room_name,
    count(b.id) FILTER(WHERE b.status IN ('pending_review','pending_payment','confirmed','checked_in','completed'))::int AS booked
    FROM session_slots sl JOIN services s ON s.id=sl.service_id JOIN users u ON u.id=sl.practitioner_id
    JOIN branches br ON br.id=sl.branch_id LEFT JOIN rooms r ON r.id=sl.room_id
    LEFT JOIN bookings b ON b.slot_id=sl.id
    WHERE sl.kind='group' AND sl.starts_at>now() AND sl.starts_at<now()+interval '90 days'
    GROUP BY sl.id,s.name,u.name,br.name,br.timezone,r.name ORDER BY sl.starts_at LIMIT 100`)).rows;
  const assignments=(await pool.query('SELECT service_id,practitioner_id FROM service_practitioners')).rows;
  res.json({rules,classes,assignments});
}));

adminRouter.post('/schedules',route(async(req,res)=>{
  const user=admin(req),input=scheduleInput.parse(req.body);
  const result=await tx(async db=>{
    await lockPractitioner(db,input.practitionerId,input.branchId);
    await ensureNoOverlap(db,input.practitionerId,input.branchId,input.weekday,input.startTime,input.endTime);
    const row=await one<{id:string}>(db,`INSERT INTO availability_rules(practitioner_id,branch_id,weekday,start_time,end_time)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[input.practitionerId,input.branchId,input.weekday,input.startTime,input.endTime]);
    await audit(db,user.id,'schedule_created','availability_rule',row!.id);
    return row;
  });res.status(201).json({schedule:result});
}));

adminRouter.patch('/schedules/:id',route(async(req,res)=>{
  const user=admin(req),id=uuid.parse(req.params.id),input=z.object({startTime:clock,endTime:clock}).parse(req.body);
  const result=await tx(async db=>{
    const existing=await one<{practitioner_id:string;branch_id:string;weekday:number}>(db,
      'SELECT practitioner_id,branch_id,weekday FROM availability_rules WHERE id=$1',[id]);
    if(!existing) fail(404,'SCHEDULE_NOT_FOUND','Schedule not found.');
    await lockPractitioner(db,existing.practitioner_id,existing.branch_id);
    await ensureNoOverlap(db,existing.practitioner_id,existing.branch_id,existing.weekday,input.startTime,input.endTime,id);
    const row=await one(db,'UPDATE availability_rules SET start_time=$2,end_time=$3 WHERE id=$1 RETURNING id',[id,input.startTime,input.endTime]);
    await audit(db,user.id,'schedule_updated','availability_rule',id);
    return row;
  });res.json({schedule:result});
}));

adminRouter.delete('/schedules/:id',route(async(req,res)=>{
  const user=admin(req),id=uuid.parse(req.params.id);
  await tx(async db=>{
    const existing=await one<{practitioner_id:string;branch_id:string}>(db,'SELECT practitioner_id,branch_id FROM availability_rules WHERE id=$1',[id]);
    if(!existing) fail(404,'SCHEDULE_NOT_FOUND','Schedule not found.');
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[existing.practitioner_id]);
    await db.query('DELETE FROM availability_rules WHERE id=$1',[id]);
    await audit(db,user.id,'schedule_deleted','availability_rule',id);
  });res.json({ok:true});
}));

adminRouter.post('/classes/:id/close',route(async(req,res)=>{
  const user=admin(req),id=uuid.parse(req.params.id);
  await tx(async db=>{
    const session=await one<{id:string;status:string}>(db,
      "SELECT id,status FROM session_slots WHERE id=$1 AND kind='group' FOR UPDATE",[id]);
    if(!session) fail(404,'CLASS_NOT_FOUND','Group class not found.');
    if(session.status==='closed') return;
    const booked=await one(db,'SELECT id FROM bookings WHERE slot_id=$1 LIMIT 1',[id]);
    if(booked) fail(409,'CLASS_HAS_BOOKINGS','This class has booking history. Contact clients before changing it.');
    await db.query("UPDATE session_slots SET status='closed' WHERE id=$1",[id]);
    await audit(db,user.id,'class_closed','session_slot',id);
  });res.json({ok:true});
}));

adminRouter.get('/users',route(async(req,res)=>{
  admin(req);
  const input=z.object({search:z.string().trim().max(100).default(''),role:role.optional(),offset:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);
  const params=[input.search,input.role||null];
  const where=`WHERE ($1='' OR u.name ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%') AND ($2::text IS NULL OR u.role=$2)`;
  const total=await one<{count:number}>(pool,`SELECT count(*)::int AS count FROM users u ${where}`,params);
  const users=(await pool.query(`SELECT u.id,u.name,u.email,u.role,u.branch_id,u.active,u.created_at,
    br.name AS branch_name FROM users u LEFT JOIN branches br ON br.id=u.branch_id ${where}
    ORDER BY u.created_at DESC,u.id DESC LIMIT 25 OFFSET $3`,[...params,input.offset])).rows;
  res.json({users,total:total!.count,offset:input.offset});
}));

adminRouter.post('/users',route(async(req,res)=>{
  const adminUser=admin(req);
  const input=z.object({name:z.string().trim().min(2).max(100),email:z.string().trim().email().max(200),
    password:z.string().min(12).max(128),role:z.enum(['practitioner','receptionist','manager','admin']),
    branchId:uuid,serviceIds:z.array(uuid).max(50).default([])}).parse(req.body);
  if(input.role==='practitioner'&&!input.serviceIds.length) fail(422,'SERVICE_REQUIRED','Assign at least one service to a new practitioner.');
  const hashed=await bcrypt.hash(input.password,12);
  try {
    const created=await tx(async db=>{
      const branch=await one(db,'SELECT id FROM branches WHERE id=$1 AND active=true',[input.branchId]);
      if(!branch) fail(422,'INVALID_BRANCH','Choose an active branch.');
      if(input.role==='practitioner') {
        const services=(await db.query('SELECT id FROM services WHERE id=ANY($1::uuid[]) AND active=true',[input.serviceIds])).rows;
        if(services.length!==new Set(input.serviceIds).size) fail(422,'INVALID_SERVICE','Choose active services.');
      }
      const result=await one<{id:string;name:string;email:string;role:string;branch_id:string;active:boolean}>(db,
        `INSERT INTO users(name,email,password_hash,role,branch_id,verified_at)
          VALUES($1,$2,$3,$4,$5,now()) RETURNING id,name,email,role,branch_id,active`,
        [input.name,input.email.toLowerCase(),hashed,input.role,input.branchId]);
      if(input.role==='practitioner') {
        await db.query('INSERT INTO practitioners(user_id) VALUES($1)',[result!.id]);
        for(const serviceId of new Set(input.serviceIds))
          await db.query('INSERT INTO service_practitioners(service_id,practitioner_id) VALUES($1,$2)',[serviceId,result!.id]);
      }
      await audit(db,adminUser.id,'user_created','user',result!.id,{role:input.role});
      return result;
    });res.status(201).json({user:created});
  } catch(error) {
    if((error as {code?:string}).code==='23505') fail(409,'ACCOUNT_EXISTS','An account already exists for this email.');
    throw error;
  }
}));

adminRouter.patch('/users/:id',route(async(req,res)=>{
  const adminUser=admin(req),id=uuid.parse(req.params.id);
  const input=z.object({name:z.string().trim().min(2).max(100).optional(),role:role.optional(),active:z.boolean().optional()})
    .refine(value=>Object.keys(value).length>0,'Choose a change.').parse(req.body);
  const result=await tx(async db=>{
    // One shared row serializes concurrent admin demotions and deactivations.
    await db.query('SELECT id FROM organizations ORDER BY id LIMIT 1 FOR UPDATE');
    const existing=await one<{id:string;name:string;role:string;active:boolean}>(db,'SELECT id,name,role,active FROM users WHERE id=$1 FOR UPDATE',[id]);
    if(!existing) fail(404,'USER_NOT_FOUND','User not found.');
    const nextRole=input.role||existing.role,nextActive=input.active??existing.active;
    if(id===adminUser.id&&(nextRole!=='admin'||!nextActive)) fail(422,'SELF_LOCKOUT','You cannot remove your own administrator access.');
    if(nextRole!==existing.role&&(nextRole==='practitioner'||existing.role==='practitioner'))
      fail(422,'PRACTITIONER_ROLE_LOCKED','Create practitioners with service assignments. Existing practitioner roles cannot be changed here.');
    if(existing.role==='admin'&&existing.active&&(nextRole!=='admin'||!nextActive)) {
      const remaining=await one<{count:number}>(db,"SELECT count(*)::int AS count FROM users WHERE role='admin' AND active=true");
      if(remaining!.count<=1) fail(422,'LAST_ADMIN','At least one active administrator is required.');
    }
    if((existing.active&&!nextActive)||(existing.role!==nextRole)) {
      const upcoming=await one(db,`SELECT b.id FROM bookings b JOIN session_slots sl ON sl.id=b.slot_id
        WHERE (b.client_id=$1 OR sl.practitioner_id=$1) AND b.status=ANY($2::text[])
        AND sl.starts_at>now() LIMIT 1`,[id,['pending_review','pending_payment','confirmed','checked_in']]);
      if(upcoming) fail(409,'UPCOMING_BOOKINGS','Cancel or complete upcoming bookings before changing this account.');
    }
    const updated=await one(db,`UPDATE users SET name=$2,role=$3,active=$4 WHERE id=$1
      RETURNING id,name,email,role,branch_id,active`,[id,input.name??existing.name,nextRole,nextActive]);
    if(nextRole!==existing.role||nextActive!==existing.active) await db.query('DELETE FROM auth_sessions WHERE user_id=$1',[id]);
    await audit(db,adminUser.id,'user_updated','user',id,{role:nextRole,active:nextActive});
    return updated;
  });res.json({user:result});
}));

adminRouter.post('/users/:id/reset-password',route(async(req,res)=>{
  const adminUser=admin(req),id=uuid.parse(req.params.id);
  if(id===adminUser.id) fail(422,'SELF_PASSWORD_RESET','Use a separate administrator account to reset your own password.');
  const input=z.object({password:z.string().min(12).max(128)}).parse(req.body);
  const hashed=await bcrypt.hash(input.password,12);
  await tx(async db=>{
    const found=await one(db,'SELECT id FROM users WHERE id=$1 FOR UPDATE',[id]);
    if(!found) fail(404,'USER_NOT_FOUND','User not found.');
    await db.query('UPDATE users SET password_hash=$2 WHERE id=$1',[id,hashed]);
    await db.query('DELETE FROM auth_sessions WHERE user_id=$1',[id]);
    await audit(db,adminUser.id,'user_password_reset','user',id);
  });res.json({ok:true});
}));
