import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DateTime} from 'luxon';

if(process.env.TEST_DATABASE!=='true') throw new Error('Admin smoke tests require a disposable test database.');
const base=process.env.BASE_URL||'http://localhost:4000/api/v1';
const origin=process.env.WEB_ORIGIN||'http://localhost:5173';
async function request(path,{method='GET',cookie,body}={}) {
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',origin,...(cookie?{cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(email,password) {
  const result=await request('/auth/login',{method:'POST',body:{email,password}});
  assert.equal(result.status,200,JSON.stringify(result.data));
  return result.cookie;
}

const cookie=await login(process.env.ADMIN_EMAIL||'admin@example.test',process.env.ADMIN_PASSWORD);
const catalog=(await request('/catalog')).data;
const branch=catalog.branches[0],practitioner=catalog.practitioners[0];
const group=catalog.services.find(item=>item.kind==='group');
assert.ok(branch&&practitioner&&group);
assert.equal((await request('/admin/schedules')).status,401);
assert.equal((await request('/admin/users',{cookie})).status,200);

const schedules=await request('/admin/schedules',{cookie});
assert.equal(schedules.status,200,JSON.stringify(schedules.data));
const created=await request('/admin/schedules',{method:'POST',cookie,body:{branchId:branch.id,practitionerId:practitioner.id,weekday:0,startTime:'12:00',endTime:'14:00'}});
assert.equal(created.status,201,JSON.stringify(created.data));
const id=created.data.schedule.id;
assert.equal((await request('/admin/schedules',{method:'POST',cookie,body:{branchId:branch.id,practitionerId:practitioner.id,weekday:0,startTime:'13:00',endTime:'15:00'}})).status,409);
assert.equal((await request(`/admin/schedules/${id}`,{method:'PATCH',cookie,body:{startTime:'12:30',endTime:'15:00'}})).status,200);
assert.equal((await request(`/admin/schedules/${id}`,{method:'DELETE',cookie})).status,200);
assert.ok(!(await request('/admin/schedules',{cookie})).data.rules.some(item=>item.id===id));

const staffCookie=await login('desk@sahana.test',process.env.DEMO_PASSWORD);
assert.equal((await request('/admin/users',{cookie:staffCookie})).status,403);
assert.equal((await request('/admin/schedules',{method:'POST',cookie:staffCookie,body:{branchId:branch.id,practitionerId:practitioner.id,weekday:0,startTime:'12:00',endTime:'14:00'}})).status,403);

const local=DateTime.now().setZone(branch.timezone).plus({days:25}).set({hour:15,minute:0,second:0,millisecond:0});
const published=await request('/staff/classes',{method:'POST',cookie,body:{branchId:branch.id,serviceId:group.id,practitionerId:practitioner.id,
  roomId:catalog.rooms.find(item=>item.branch_id===branch.id&&item.capacity>=group.capacity)?.id,
  localStart:local.toFormat("yyyy-MM-dd'T'HH:mm")}});
assert.equal(published.status,201,JSON.stringify(published.data));
const classId=published.data.session.id;
const listed=(await request('/admin/schedules',{cookie})).data.classes.find(item=>item.id===classId);
assert.ok(listed,'new group class appears in the admin schedule');
assert.equal(new Date(listed.starts_at).getTime(),local.toUTC().toMillis());
assert.equal((await request(`/admin/classes/${classId}/close`,{method:'POST',cookie,body:{}})).status,200);

const bookedTime=local.plus({days:1});
const bookedClass=await request('/staff/classes',{method:'POST',cookie,body:{branchId:branch.id,serviceId:group.id,practitionerId:practitioner.id,
  localStart:bookedTime.toFormat("yyyy-MM-dd'T'HH:mm")}});
assert.equal(bookedClass.status,201,JSON.stringify(bookedClass.data));
const bookedClassId=bookedClass.data.session.id;
const clientEmail=`calendar-${crypto.randomUUID().slice(0,8)}@example.test`;
const client=await request('/auth/register',{method:'POST',body:{name:'Calendar Client',email:clientEmail,
  password:'ClientPassword2026!',birthDate:'1994-05-20'}});
assert.equal(client.status,201,JSON.stringify(client.data));
const booked=await request('/bookings',{method:'POST',cookie:client.cookie,body:{serviceId:group.id,branchId:branch.id,slotId:bookedClassId}});
assert.equal(booked.status,201,JSON.stringify(booked.data));
assert.equal((await request(`/admin/classes/${bookedClassId}/close`,{method:'POST',cookie,body:{}})).status,409,'cannot close a class with booking history');
const clientId=(await request('/auth/me',{cookie:client.cookie})).data.user.id;
assert.equal((await request(`/admin/users/${clientId}`,{method:'PATCH',cookie,body:{active:false}})).status,409,'cannot suspend an account with upcoming bookings');

const suffix=crypto.randomUUID().slice(0,8);
const email=`team-${suffix}@example.test`,initial='InitialPassword2026!',replacement='ChangedPassword2026!';
const newUser=await request('/admin/users',{method:'POST',cookie,body:{name:'Studio Teammate',email,password:initial,role:'manager',branchId:branch.id}});
assert.equal(newUser.status,201,JSON.stringify(newUser.data));
const userId=newUser.data.user.id;
assert.equal((await request('/admin/users?search='+suffix,{cookie})).data.users.some(item=>item.id===userId),true);
const teamCookie=await login(email,initial);
assert.equal((await request('/admin/users',{cookie:teamCookie})).status,403);
assert.equal((await request(`/admin/users/${userId}`,{method:'PATCH',cookie,body:{name:'Studio Reception',role:'receptionist',active:true}})).status,200);
assert.equal((await request('/auth/me',{cookie:teamCookie})).data.user,null,'role change ends old sessions');
const nextCookie=await login(email,initial);
assert.equal((await request(`/admin/users/${userId}/reset-password`,{method:'POST',cookie,body:{password:replacement}})).status,200);
assert.equal((await request('/auth/me',{cookie:nextCookie})).data.user,null,'password reset ends sessions');
assert.equal((await request('/auth/login',{method:'POST',body:{email,password:initial}})).status,401);
await login(email,replacement);
assert.equal((await request(`/admin/users/${userId}`,{method:'PATCH',cookie,body:{active:false}})).status,200);
assert.equal((await request('/auth/login',{method:'POST',body:{email,password:replacement}})).status,401);
const me=(await request('/auth/me',{cookie})).data.user;
assert.equal((await request(`/admin/users/${me.id}`,{method:'PATCH',cookie,body:{role:'client'}})).status,422);
console.log('Admin smoke passed: schedule conflicts, class publishing, booking safeguards, access rules, user lifecycle, and session invalidation.');
