import bcrypt from 'bcryptjs';
import {DateTime} from 'luxon';
import {pool, tx} from './core.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing. On Windows, run DATABASE_SETUP.bat before db:seed.');
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12 || !process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12) {
  throw new Error('Set ADMIN_PASSWORD and DEMO_PASSWORD to at least 12 characters before seeding.');
}
await tx(async db => {
  if ((await db.query('SELECT 1 FROM organizations LIMIT 1')).rowCount) {console.log('Existing organization; seed skipped.'); return;}
  const org = (await db.query<{id:string}>("INSERT INTO organizations(name) VALUES('Sahana Yoga Studio') RETURNING id")).rows[0]!;
  const branch = (await db.query<{id:string}>("INSERT INTO branches(organization_id,name,address,contact) VALUES($1,'Colombo Studio','42 Garden Lane, Colombo 07','+94 11 555 0123') RETURNING id",[org.id])).rows[0]!;
  const room = (await db.query<{id:string}>("INSERT INTO rooms(branch_id,name,capacity) VALUES($1,'Lotus Room',12) RETURNING id",[branch.id])).rows[0]!;
  await db.query("INSERT INTO rooms(branch_id,name,capacity) VALUES($1,'Quiet Room',2)",[branch.id]);
  const adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD!,12), demoHash = await bcrypt.hash(process.env.DEMO_PASSWORD!,12);
  await db.query("INSERT INTO users(email,password_hash,name,role,branch_id,verified_at) VALUES($1,$2,'Studio Administrator','admin',$3,now())",[(process.env.ADMIN_EMAIL||'admin@sahana.test').toLowerCase(),adminHash,branch.id]);
  const practitionerIds: string[] = [];
  for (const [email,name,bio,qualifications,languages] of [
    ['maya@sahana.test','Maya Perera','Gentle movement and mindful breathing, adapted to each person.','Yoga teacher · 8 years experience',['en','si']],
    ['arun@sahana.test','Arun Fernando','Grounded movement and small group teaching for everyday wellbeing.','Yoga teacher · 6 years experience',['en','ta']]
  ] as const) {
    const p = (await db.query<{id:string}>("INSERT INTO users(email,password_hash,name,role,branch_id,verified_at) VALUES($1,$2,$3,'practitioner',$4,now()) RETURNING id",[email,demoHash,name,branch.id])).rows[0]!;
    practitionerIds.push(p.id);
    await db.query('INSERT INTO practitioners(user_id,bio,qualifications,languages) VALUES($1,$2,$3,$4)',[p.id,bio,qualifications,languages]);
    for (let day=1;day<=6;day++) await db.query('INSERT INTO availability_rules(practitioner_id,branch_id,weekday,start_time,end_time) VALUES($1,$2,$3,$4,$5)',[p.id,branch.id,day,'08:00','18:00']);
  }
  await db.query("INSERT INTO users(email,password_hash,name,role,branch_id,verified_at) VALUES('desk@sahana.test',$1,'Front Desk','receptionist',$2,now())",[demoHash,branch.id]);
  const services = [
    ['Therapeutic Yoga Consultation','A one-to-one session focused on your needs, with practitioner review before confirmation.','Therapeutic','private',60,650000,1,true,'peach'],
    ['Gentle Flow','An unhurried group practice for mobility, balance and mindful breathing.','Movement','group',60,250000,12,false,'sage'],
    ['Private Yoga Session','Personal movement and breathing guidance at your pace.','Private','private',60,500000,1,false,'lavender'],
    ['Online Breathwork','A guided one-to-one session from wherever you feel comfortable.','Online','online',45,350000,1,false,'blue']
  ] as const;
  const serviceIds: string[] = [];
  for (const [name,summary,category,kind,duration,price,capacity,review,accent] of services) {
    const s = (await db.query<{id:string}>('INSERT INTO services(name,summary,category,kind,duration_minutes,price_cents,capacity,requires_review,accent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[name,summary,category,kind,duration,price,capacity,review,accent])).rows[0]!;
    serviceIds.push(s.id);
    for (const practitionerId of practitionerIds) await db.query('INSERT INTO service_practitioners(service_id,practitioner_id) VALUES($1,$2)',[s.id,practitionerId]);
  }
  await db.query('INSERT INTO packages(service_id,name,sessions,price_cents,validity_days) VALUES($1,$2,5,$3,90)',[serviceIds[2],'Five private sessions',2200000]);
  await db.query('INSERT INTO intake_forms(version,title,questions) VALUES(1,$1,$2)', ['Therapeutic session intake',JSON.stringify([
    {key:'goal',label:'What would you like support with?',type:'textarea',required:true},
    {key:'limitations',label:'Any movement limitations or recent injuries the practitioner should know about?',type:'textarea',required:false},
    {key:'considerations',label:'Any other considerations for a safe session?',type:'textarea',required:false}
  ])]);
  const now = DateTime.now().setZone('Asia/Colombo');
  const demoClassCapacity=process.env.TEST_GROUP_CAPACITY==='1'?1:12;
  for (let offset=1; offset<=18; offset++) {
    const day = now.plus({days:offset}); if (![2,4,6].includes(day.weekday)) continue;
    const starts = day.set({hour:9,minute:0,second:0,millisecond:0});
    const ends = starts.plus({minutes:60});
    await db.query('INSERT INTO session_slots(service_id,branch_id,practitioner_id,room_id,starts_at,ends_at,occupied_start_at,occupied_end_at,capacity,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,\'group\')',
      [serviceIds[1],branch.id,practitionerIds[1],room.id,starts.toUTC().toISO(),ends.toUTC().toISO(),starts.minus({minutes:10}).toUTC().toISO(),ends.plus({minutes:10}).toUTC().toISO(),demoClassCapacity]);
  }
  console.log('Seeded studio, staff, services, availability and group classes.');
});
await pool.end();
