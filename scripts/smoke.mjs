import assert from 'node:assert/strict';
import crypto from 'node:crypto';

if(process.env.TEST_DATABASE!=='true') throw new Error('Set TEST_DATABASE=true only for an isolated disposable test database.');

const base=process.env.BASE_URL||'http://localhost:4000/api/v1';
const origin=process.env.WEB_ORIGIN||'http://localhost:5173';
const random=crypto.randomUUID().slice(0,8);
async function request(path,{method='GET',cookie,body}={}) {
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',origin,...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function register(name) {
  const response=await request('/auth/register',{method:'POST',body:{name,email:`${name}.${random}@example.test`,password:'A-long-demo-password-2026!',birthDate:'1994-05-20'}});
  assert.equal(response.status,201,JSON.stringify(response.data));return response.cookie;
}
const cookieA=await register('alice'),cookieB=await register('bob');
const catalog=(await request('/catalog')).data;
assert.equal(catalog.services.length>=4,true);
const privateService=catalog.services.find(s=>s.kind==='private'&&!s.requires_review);
const therapy=catalog.services.find(s=>s.requires_review);
const group=catalog.services.find(s=>s.kind==='group');
const branch=catalog.branches[0];
assert.ok(privateService&&therapy&&group&&branch);
const start=new Date(Date.now()+24*3600000);
let available=[];
for(let i=0;i<7&&!available.length;i++) {
  const date=new Date(start.getTime()+i*86400000).toLocaleDateString('en-CA',{timeZone:branch.timezone});
  available=(await request(`/availability?${new URLSearchParams({serviceId:privateService.id,branchId:branch.id,date})}`)).data.slots;
}
assert.ok(available.length,'private availability exists');
const slot=available[0];
const body={serviceId:privateService.id,branchId:branch.id,practitionerId:slot.practitioner_id,startsAt:slot.starts_at};
const [one,two]=await Promise.all([
  request('/bookings',{method:'POST',cookie:cookieA,body}),request('/bookings',{method:'POST',cookie:cookieB,body})
]);
assert.deepEqual([one.status,two.status].sort(),[201,409],`private race: ${one.status}, ${two.status}`);
const successful=one.status===201?one:two, winner=one.status===201?cookieA:cookieB,loser=winner===cookieA?cookieB:cookieA;
const booking=successful.data.booking;
assert.equal(booking.status,'pending_payment');
assert.equal((await request(`/bookings/${booking.id}`,{cookie:loser})).status,404,'other client cannot access booking');
const key=crypto.randomUUID();
const paid=await request(`/bookings/${booking.id}/pay`,{method:'POST',cookie:winner,body:{idempotencyKey:key}});
assert.equal(paid.status,200,JSON.stringify(paid.data));assert.equal(paid.data.booking.status,'confirmed');
const paidAgain=await request(`/bookings/${booking.id}/pay`,{method:'POST',cookie:winner,body:{idempotencyKey:key}});
assert.equal(paidAgain.data.booking.status,'confirmed');

const form=(await request('/intake-form')).data.form;
let therapySlot=[];
for(let i=0;i<7&&!therapySlot.length;i++) {
  const date=new Date(start.getTime()+i*86400000).toLocaleDateString('en-CA',{timeZone:branch.timezone});
  therapySlot=(await request(`/availability?${new URLSearchParams({serviceId:therapy.id,branchId:branch.id,date})}`)).data.slots;
}
assert.ok(therapySlot.length);
const ts=therapySlot.find(s=>s.starts_at!==slot.starts_at)||therapySlot[0];
const intake=await request('/bookings',{method:'POST',cookie:loser,body:{serviceId:therapy.id,branchId:branch.id,practitionerId:ts.practitioner_id,startsAt:ts.starts_at,formId:form.id,intake:{goal:'Gentle movement',limitations:'No injuries'},consent:true}});
assert.equal(intake.status,201,JSON.stringify(intake.data));
assert.equal(intake.data.booking.status,'pending_review');
assert.equal((await request(`/bookings/${intake.data.booking.id}/intake`,{cookie:winner})).status,404,'other client cannot read intake');
assert.equal((await request(`/staff/bookings/${intake.data.booking.id}/notes`,{cookie:winner})).status,403,'notes not exposed');
const practitioner=catalog.practitioners.find(p=>p.id===ts.practitioner_id);
const practitionerEmail=practitioner.name.startsWith('Maya')?'maya@sahana.test':'arun@sahana.test';
const login=await request('/auth/login',{method:'POST',body:{email:practitionerEmail,password:process.env.DEMO_PASSWORD}});
assert.equal(login.status,200,JSON.stringify(login.data));
const assignedCookie=login.cookie;
const otherEmail=practitionerEmail.startsWith('maya')?'arun@sahana.test':'maya@sahana.test';
const otherLogin=await request('/auth/login',{method:'POST',body:{email:otherEmail,password:process.env.DEMO_PASSWORD}});
assert.equal((await request(`/bookings/${intake.data.booking.id}/intake`,{cookie:otherLogin.cookie})).status,404,'unassigned practitioner cannot read intake');
assert.equal((await request(`/bookings/${intake.data.booking.id}/intake`,{cookie:assignedCookie})).status,200);
const approved=await request(`/bookings/${intake.data.booking.id}/review`,{method:'POST',cookie:assignedCookie,body:{decision:'approved',comment:'Suitable for a gentle session.'}});
assert.equal(approved.data.booking.status,'pending_payment');
const therapyPaid=await request(`/bookings/${intake.data.booking.id}/pay`,{method:'POST',cookie:loser,body:{idempotencyKey:crypto.randomUUID()}});
assert.equal(therapyPaid.data.booking.status,'confirmed');
assert.equal((await request(`/staff/bookings/${intake.data.booking.id}/notes`,{cookie:otherLogin.cookie})).status,404);
const noteSaved=await request(`/staff/bookings/${intake.data.booking.id}/notes`,{method:'PUT',cookie:assignedCookie,body:{notes:'Gentle seated movement session plan.'}});
assert.equal(noteSaved.status,200);
assert.equal((await request(`/staff/bookings/${intake.data.booking.id}/notes`,{cookie:assignedCookie})).data.notes,'Gentle seated movement session plan.');
const leave=await request('/staff/time-off',{method:'POST',cookie:assignedCookie,body:{practitionerId:ts.practitioner_id,startsAt:ts.starts_at,endsAt:ts.ends_at,reason:'Leave'}});
assert.equal(leave.status,409,'time off must flag an existing booking');

const classes=[];
for(let i=0;i<18;i++) {
  const date=new Date(start.getTime()+i*86400000).toLocaleDateString('en-CA',{timeZone:branch.timezone});
  const result=(await request(`/availability?${new URLSearchParams({serviceId:group.id,branchId:branch.id,date})}`)).data.slots;
  if(result.length) {classes.push(...result);break;}
}
assert.ok(classes.length,'seeded group class available');
const classSlot=classes[0];
const groupBody={serviceId:group.id,branchId:branch.id,slotId:classSlot.id};
const cookieC=await register('charlie'),cookieD=await register('dina');
const [a,b]=await Promise.all([request('/bookings',{method:'POST',cookie:cookieC,body:groupBody}),request('/bookings',{method:'POST',cookie:cookieD,body:groupBody})]);
assert.deepEqual([a.status,b.status].sort(),[201,409],`group race: ${a.status}, ${b.status}`);
assert.equal(classSlot.capacity,1);
const stillListed=(await request(`/availability?${new URLSearchParams({serviceId:group.id,branchId:branch.id,date:new Date(classSlot.starts_at).toLocaleDateString('en-CA',{timeZone:branch.timezone})})}`)).data.slots;
assert.equal(stillListed.some(s=>s.id===classSlot.id),false);
console.log('PASS: auth, catalog, slot conflict, ownership, sandbox payment/idempotency, intake review and note access, leave conflict, last group seat.');
