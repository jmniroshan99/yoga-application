import {useEffect,useState,type FormEvent} from 'react';
import {Activity,ArrowRight,Ban,CalendarDays,Check,ChevronLeft,ChevronRight,Clock3,LayoutDashboard,Leaf,LockKeyhole,MapPin,Pencil,Plus,RefreshCw,Search,ShieldCheck,Trash2,UserRound,Users,Wallet} from 'lucide-react';
import './admin.css';

type Catalog={branches:{id:string;name:string;timezone:string}[];practitioners:{id:string;name:string;branch_id:string}[];services:{id:string;name:string;kind:string}[];rooms:{id:string;name:string;branch_id:string;capacity:number}[]};
type Rule={id:string;practitioner_id:string;branch_id:string;weekday:number;start_time:string;end_time:string;practitioner_name:string;branch_name:string};
type ClassSession={id:string;service_name:string;branch_id:string;practitioner_name:string;room_name:string|null;starts_at:string;capacity:number;booked:number;status:string;timezone:string};
type ManagedUser={id:string;name:string;email:string;role:string;branch_id:string|null;branch_name:string|null;active:boolean;created_at:string};
type ScheduleData={rules:Rule[];classes:ClassSession[];assignments:{service_id:string;practitioner_id:string}[]};
type Report={totals:{confirmed:number;completed:number;cancelled:number;no_show:number;revenue_cents:string};byService:{name:string;bookings:number}[]};
type Overview={upcoming:unknown[];reviews:unknown[]};
type AuditEvent={id:string;action:string;entity_type:string;created_at:string};
type View='overview'|'schedules'|'people';
type RoleFilter='all'|'client'|'practitioner'|'receptionist'|'manager'|'admin';
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const staffRoles=['receptionist','manager','practitioner','admin'] as const;
const accessRoles=['client','receptionist','manager','admin'] as const;

async function request<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch('/api/v1'+path,{credentials:'include',headers:{'Content-Type':'application/json',...options.headers},...options});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error?.message||`Request failed (${response.status})`);
  return result as T;
}
const currency=(cents:number)=>new Intl.NumberFormat('en-LK',{style:'currency',currency:'LKR',maximumFractionDigits:0}).format(cents/100);

export default function AdminWorkspace({catalog,currentUserId,adminName,onCurrentUserUpdated}:{catalog:Catalog|null;currentUserId:string;adminName:string;onCurrentUserUpdated:()=>void}){
  const [view,setView]=useState<View>('overview');
  const [schedule,setSchedule]=useState<ScheduleData>({rules:[],classes:[],assignments:[]});
  const [users,setUsers]=useState<ManagedUser[]>([]),[total,setTotal]=useState(0),[offset,setOffset]=useState(0);
  const [search,setSearch]=useState(''),[roleFilter,setRoleFilter]=useState<RoleFilter>('all');
  const [report,setReport]=useState<Report|null>(null);
  const [overview,setOverview]=useState<Overview|null>(null);
  const [auditEvents,setAuditEvents]=useState<AuditEvent[]>([]);
  const [activityError,setActivityError]=useState(false);
  const [lastUpdated,setLastUpdated]=useState<Date|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [message,setMessage]=useState<{kind:'success'|'error';text:string}|null>(null);
  const [rule,setRule]=useState({branchId:'',practitionerId:'',weekday:1,startTime:'08:00',endTime:'18:00'});
  const [editingRule,setEditingRule]=useState<string|null>(null);
  const [classForm,setClassForm]=useState({branchId:'',serviceId:'',practitionerId:'',roomId:'',localStart:''});
  const [createRole,setCreateRole]=useState<typeof staffRoles[number]>('receptionist');
  const [createBranch,setCreateBranch]=useState(''),[serviceIds,setServiceIds]=useState<string[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [editingUser,setEditingUser]=useState({name:'',role:'client',active:true});
  const [newPassword,setNewPassword]=useState('');

  useEffect(()=>{
    const first=catalog?.branches[0]?.id;
    if(first){setRule(form=>form.branchId?form:{...form,branchId:first});setClassForm(form=>form.branchId?form:{...form,branchId:first});setCreateBranch(value=>value||first);}
  },[catalog]);
  const showError=(e:unknown)=>setMessage({kind:'error',text:e instanceof Error?e.message:'Please try again.'});
  const showSuccess=(text:string)=>setMessage({kind:'success',text});
  const loadSchedules=async()=>setSchedule(await request<ScheduleData>('/admin/schedules'));
  const loadUsers=async()=>{
    const params=new URLSearchParams({search,offset:String(offset)});if(roleFilter!=='all')params.set('role',roleFilter);
    const result=await request<{users:ManagedUser[];total:number}>('/admin/users?'+params);
    setUsers(result.users);setTotal(result.total);
  };
  const refreshAudit=async()=>{try{
    const result=await request<{events:AuditEvent[]}>('/staff/audit');setAuditEvents(result.events);setActivityError(false);
  }catch{setAuditEvents([]);setActivityError(true);}};
  const refreshOverview=async()=>{
    const [r,o]=await Promise.all([request<Report>('/staff/reports'),request<Overview>('/staff/overview')]);
    setReport(r);setOverview(o);setLastUpdated(new Date());await refreshAudit();
  };
  useEffect(()=>{let active=true;void Promise.all([request<ScheduleData>('/admin/schedules'),
    request<Report>('/staff/reports'),request<Overview>('/staff/overview')])
    .then(([s,r,o])=>{if(active){setSchedule(s);setReport(r);setOverview(o);setLastUpdated(new Date());}})
    .catch(e=>{if(active)showError(e);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  useEffect(()=>{void refreshAudit();},[]);
  useEffect(()=>{if(view!=='overview')return;const timer=window.setInterval(()=>{
    if(document.visibilityState==='visible')void refreshOverview().catch(showError);
  },60000);return()=>window.clearInterval(timer);},[view]);
  useEffect(()=>{let active=true;const timer=window.setTimeout(()=>{
    const params=new URLSearchParams({search,offset:String(offset)});if(roleFilter!=='all')params.set('role',roleFilter);
    void request<{users:ManagedUser[];total:number}>('/admin/users?'+params)
      .then(result=>{if(active){setUsers(result.users);setTotal(result.total);}}).catch(e=>{if(active)showError(e);});
  },200);return()=>{active=false;window.clearTimeout(timer);};},[search,roleFilter,offset]);
  const action=async(fn:()=>Promise<void>,success:string)=>{
    setBusy(true);setMessage(null);try{await fn();showSuccess(success);}catch(e){showError(e);}finally{setBusy(false);}
  };
  const saveRule=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();void action(async()=>{
    if(editingRule)await request(`/admin/schedules/${editingRule}`,{method:'PATCH',body:JSON.stringify({startTime:rule.startTime,endTime:rule.endTime})});
    else await request('/admin/schedules',{method:'POST',body:JSON.stringify(rule)});
    setEditingRule(null);await loadSchedules();
  },editingRule?'Hours updated. Existing bookings stay unchanged.':'Weekly hours added. New booking times are available.');};
  const deleteRule=(item:Rule)=>{if(!window.confirm(`Remove ${item.practitioner_name}'s ${days[item.weekday]} hours? Existing bookings remain.`))return;
    void action(async()=>{await request(`/admin/schedules/${item.id}`,{method:'DELETE'});await loadSchedules();},'Hours removed. Existing bookings remain.');};
  const addClass=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();void action(async()=>{
    await request('/staff/classes',{method:'POST',body:JSON.stringify({...classForm,roomId:classForm.roomId||undefined})});
    setClassForm(form=>({...form,localStart:''}));await loadSchedules();
  },'Group class published.');};
  const closeClass=(item:ClassSession)=>{if(!window.confirm(`Close this unbooked ${item.service_name} class?`))return;
    void action(async()=>{await request(`/admin/classes/${item.id}/close`,{method:'POST',body:'{}'});await loadSchedules();},'Class closed.');};
  const createUser=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);
    void action(async()=>{await request('/admin/users',{method:'POST',body:JSON.stringify({name:data.get('name'),email:data.get('email'),password:data.get('password'),role:createRole,branchId:createBranch,serviceIds:createRole==='practitioner'?serviceIds:[]})});
      form.reset();setServiceIds([]);await loadUsers();},'Staff account created. Share its password privately.');};
  const selectedUser=users.find(item=>item.id===selectedId);
  const saveUser=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!selectedUser)return;
    void action(async()=>{await request(`/admin/users/${selectedUser.id}`,{method:'PATCH',body:JSON.stringify(editingUser)});
      await loadUsers();if(selectedUser.id===currentUserId)onCurrentUserUpdated();},'Account access updated.');};
  const resetPassword=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!selectedUser)return;
    if(!window.confirm(`Reset ${selectedUser.email}'s password and end active sessions?`))return;
    void action(async()=>{await request(`/admin/users/${selectedUser.id}/reset-password`,{method:'POST',body:JSON.stringify({password:newPassword})});setNewPassword('');},'Password reset. Share it privately.');};
  const branchPractitioners=(id:string)=>catalog?.practitioners.filter(item=>item.branch_id===id)||[];
  const groupServices=catalog?.services.filter(item=>item.kind==='group')||[];
  const assigned=branchPractitioners(classForm.branchId).filter(item=>schedule.assignments.some(a=>a.practitioner_id===item.id&&a.service_id===classForm.serviceId));
  const visibleRules=schedule.rules.filter(item=>item.branch_id===rule.branchId);
  const visibleClasses=schedule.classes.filter(item=>item.branch_id===classForm.branchId);
  const timezone=catalog?.branches.find(item=>item.id===classForm.branchId)?.timezone||'Asia/Colombo';
  const serviceChart=report?.byService.slice(0,5)||[];
  const maxBookings=Math.max(1,...serviceChart.map(item=>item.bookings));
  return <main className="admin-workspace">
    <div className="admin-layout">
      <aside className="admin-sidebar" aria-label="Studio workspace navigation">
        <div className="admin-sidebar-brand"><span className="admin-sidebar-logo"><Leaf size={24}/></span><span><strong>Sahana Yoga</strong><small>STUDIO WORKSPACE</small></span></div>
        <nav className="admin-nav" aria-label="Admin sections">
          <span className="admin-nav-caption">WORKSPACE</span>
          <button type="button" aria-current={view==='overview'?'page':undefined} className={view==='overview'?'selected':''} onClick={()=>setView('overview')}><LayoutDashboard size={18}/> Overview</button>
          <button type="button" aria-current={view==='schedules'?'page':undefined} className={view==='schedules'?'selected':''} onClick={()=>setView('schedules')}><CalendarDays size={18}/> Time schedules</button>
          <button type="button" aria-current={view==='people'?'page':undefined} className={view==='people'?'selected':''} onClick={()=>setView('people')}><Users size={18}/> People & access</button>
        </nav>
        <div className="admin-sidebar-note"><ShieldCheck size={18}/><span>Private studio workspace</span></div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar"><div><span className="admin-topbar-kicker">SAHANA / STUDIO</span><h1>{view==='overview'?'Overview':view==='schedules'?'Time schedules':'People & access'}</h1></div>
          <div className="admin-topbar-actions">{view==='overview'&&<><span className="admin-live"><span/> Auto-refresh · 60s</span><button className="admin-quiet" type="button" disabled={loading} onClick={()=>{setLoading(true);void refreshOverview().catch(showError).finally(()=>setLoading(false));}}><RefreshCw size={15}/> Refresh</button></>}<span className="admin-avatar" aria-label={`Signed in as ${adminName}`}>{adminName.charAt(0).toUpperCase()}</span></div>
        </header>
    {message&&<div className={`admin-message ${message.kind}`} role={message.kind==='error'?'alert':'status'}>
      {message.kind==='success'?<Check size={18}/>:<Ban size={18}/>}<span>{message.text}</span>
      <button type="button" onClick={()=>setMessage(null)} aria-label="Dismiss message">×</button></div>}
    {view==='overview'&&<section className="admin-content" aria-label="Studio overview">
      <div className="admin-section-head"><div><span className="admin-label">STUDIO AT A GLANCE</span><h2>Good to see you, {adminName.split(' ')[0]}.</h2><p>Real studio activity, thoughtfully arranged in one place.</p></div><span className="admin-updated">{lastUpdated?`Updated ${lastUpdated.toLocaleTimeString('en-LK',{hour:'numeric',minute:'2-digit'})}`:'Connecting to studio data'}</span></div>
      <div className="admin-stats" aria-busy={loading}>
        <article><span className="stat-icon"><CalendarDays/></span><small>Upcoming bookings</small><strong>{overview?.upcoming.length??'—'}</strong><span>On the calendar</span></article>
        <article><span className="stat-icon"><Activity/></span><small>Awaiting review</small><strong>{overview?.reviews.length??'—'}</strong><span>Practitioner queue</span></article>
        <article><span className="stat-icon"><Check/></span><small>Completed</small><strong>{report?.totals.completed??'—'}</strong><span>Sessions delivered</span></article>
        <article><span className="stat-icon"><Wallet/></span><small>Recorded revenue</small><strong>{report?currency(Number(report.totals.revenue_cents)):'—'}</strong><span>Payments recorded</span></article>
      </div>
      <div className="admin-insights">
        <article className="admin-panel admin-chart"><div className="admin-panel-head"><span className="panel-icon"><Activity/></span><div><h3>Bookings by service</h3><p>Non-cancelled bookings · all time</p></div></div>
          {serviceChart.length?<ul className="admin-bars">{serviceChart.map(item=><li key={item.name}><div className="admin-bar-label"><span>{item.name}</span><strong>{item.bookings}</strong></div><div className="admin-bar-track" aria-hidden="true"><span style={{width:`${item.bookings/maxBookings*100}%`}}/></div></li>)}</ul>:<p className="admin-empty">{loading?'Loading service insights…':report?'Bookings will appear here as clients reserve sessions.':'Service insights are unavailable right now.'}</p>}
        </article>
        <article className="admin-panel admin-activity"><div className="admin-panel-head"><span className="panel-icon secondary"><Activity/></span><div><h3>Recent activity</h3><p>Latest recorded studio actions</p></div></div>
          {auditEvents.length?<ol className="admin-activity-list">{auditEvents.slice(0,5).map(event=><li key={event.id}><span className="admin-activity-dot" aria-hidden="true"/><div><strong>{event.action.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase())}</strong><span>{event.entity_type.replaceAll('_',' ')} · <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString('en-LK',{dateStyle:'medium',timeStyle:'short'})}</time></span></div></li>)}</ol>:<p className="admin-empty">{activityError?'Activity is unavailable right now.':loading?'Loading activity…':'No studio activity has been recorded yet.'}</p>}
        </article>
      </div>
      <div className="admin-quick">
        <article><span className="quick-icon"><Clock3/></span><h3>Build your calendar</h3><p>Add recurring hours and publish group classes. Clients see open times from your real schedule.</p><button type="button" onClick={()=>setView('schedules')}>Open time schedules <ArrowRight size={16}/></button></article>
        <article><span className="quick-icon"><UserRound/></span><h3>Manage your team</h3><p>Find accounts, assign access, and create staff logins from the studio dashboard.</p><button type="button" onClick={()=>setView('people')}>Open people & access <ArrowRight size={16}/></button></article>
      </div>
    </section>}
    {view==='schedules'&&<section className="admin-content" aria-label="Time schedules">
      <div className="admin-section-head"><div><span className="admin-label">PRACTITIONER HOURS</span><h2>Time schedules</h2>
        <p>Weekly hours generate private appointment times. Existing bookings stay in place when hours change.</p></div></div>
      <div className="admin-two-col">
        <div className="admin-panel"><div className="admin-panel-head"><span className="panel-icon"><Clock3/></span><div><h3>{editingRule?'Edit weekly hours':'Add weekly hours'}</h3><p>Times follow the selected branch.</p></div></div>
          <form id="hours-form" className="admin-form" onSubmit={saveRule}>
            <label>Branch<select required value={rule.branchId} disabled={Boolean(editingRule)} onChange={e=>setRule({...rule,branchId:e.target.value,practitionerId:''})}>
              {catalog?.branches.map(item=><option value={item.id} key={item.id}>{item.name} · {item.timezone}</option>)}</select></label>
            <label>Practitioner<select required value={rule.practitionerId} disabled={Boolean(editingRule)} onChange={e=>setRule({...rule,practitionerId:e.target.value})}>
              <option value="">Choose practitioner</option>{branchPractitioners(rule.branchId).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>Day<select value={rule.weekday} disabled={Boolean(editingRule)} onChange={e=>setRule({...rule,weekday:Number(e.target.value)})}>
              {days.map((day,i)=><option value={i} key={day}>{day}</option>)}</select></label>
            <div className="admin-form-pair"><label>Opens<input type="time" required value={rule.startTime} onChange={e=>setRule({...rule,startTime:e.target.value})}/></label>
              <label>Closes<input type="time" required value={rule.endTime} onChange={e=>setRule({...rule,endTime:e.target.value})}/></label></div>
            <div className="admin-form-actions"><button className="btn primary" type="submit" disabled={busy||!rule.practitionerId}><Plus size={17}/>{editingRule?'Save hours':'Add hours'}</button>
              {editingRule&&<button className="admin-quiet" type="button" onClick={()=>setEditingRule(null)}>Cancel edit</button>}</div>
          </form>
        </div>
        <div className="admin-panel"><div className="admin-panel-head"><span className="panel-icon secondary"><CalendarDays/></span><div><h3>Current weekly hours</h3><p>{visibleRules.length} blocks at this branch</p></div></div>
          <div className="admin-rules">{visibleRules.length?visibleRules.map(item=><div className="admin-rule" key={item.id}>
            <span className="rule-day">{days[item.weekday].slice(0,3)}</span><div><strong>{item.start_time} – {item.end_time}</strong><small>{item.practitioner_name} · {days[item.weekday]}</small></div>
            <div className="rule-actions"><button type="button" aria-label={`Edit ${item.practitioner_name} ${days[item.weekday]} hours`} onClick={()=>{setEditingRule(item.id);setRule({branchId:item.branch_id,practitionerId:item.practitioner_id,weekday:item.weekday,startTime:item.start_time,endTime:item.end_time});document.getElementById('hours-form')?.scrollIntoView({behavior:'smooth',block:'center'});}}><Pencil size={16}/></button>
              <button type="button" disabled={busy} aria-label={`Remove ${item.practitioner_name} ${days[item.weekday]} hours`} onClick={()=>deleteRule(item)}><Trash2 size={16}/></button></div></div>):<p className="admin-empty">No weekly hours at this branch. Add a block to open booking times.</p>}</div>
        </div>
      </div>
      <div className="admin-section-head admin-subheading"><div><span className="admin-label">GROUP PROGRAMME</span><h2>Upcoming classes</h2>
        <p>Publish a class in the branch’s local time. Choose a room when one is available.</p></div></div>
      <div className="admin-two-col">
        <div className="admin-panel"><div className="admin-panel-head"><span className="panel-icon"><Plus/></span><div><h3>Add a group class</h3><p>Classes appear in public booking.</p></div></div>
          <form className="admin-form" onSubmit={addClass}>
            <label>Branch<select required value={classForm.branchId} onChange={e=>setClassForm({...classForm,branchId:e.target.value,practitionerId:'',roomId:''})}>
              {catalog?.branches.map(item=><option value={item.id} key={item.id}>{item.name} · {item.timezone}</option>)}</select></label>
            <label>Group service<select required value={classForm.serviceId} onChange={e=>setClassForm({...classForm,serviceId:e.target.value,practitionerId:''})}>
              <option value="">Choose a service</option>{groupServices.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>Practitioner<select required value={classForm.practitionerId} onChange={e=>setClassForm({...classForm,practitionerId:e.target.value})}>
              <option value="">Choose an assigned practitioner</option>{assigned.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>Room (optional)<select value={classForm.roomId} onChange={e=>setClassForm({...classForm,roomId:e.target.value})}>
              <option value="">No room selected</option>{catalog?.rooms.filter(item=>item.branch_id===classForm.branchId).map(item=><option value={item.id} key={item.id}>{item.name} · {item.capacity} places</option>)}</select></label>
            <label>Start date & time · {timezone}<input required type="datetime-local" value={classForm.localStart} onChange={e=>setClassForm({...classForm,localStart:e.target.value})}/></label>
            <p className="admin-hint">Service duration and capacity come from the existing catalog. Choose a date within 90 days.</p>
            <button className="btn primary" type="submit" disabled={busy||!classForm.practitionerId}><Plus size={17}/> Publish class</button>
          </form>
        </div>
        <div className="admin-panel"><div className="admin-panel-head"><span className="panel-icon secondary"><MapPin/></span><div><h3>On the calendar</h3><p>Next 90 days · {visibleClasses.length} classes</p></div></div>
          <div className="admin-class-list">{visibleClasses.length?visibleClasses.map(item=><div className="admin-class" key={item.id}>
            <div className="admin-class-date"><b>{new Date(item.starts_at).toLocaleDateString('en-GB',{day:'2-digit',timeZone:item.timezone})}</b><small>{new Date(item.starts_at).toLocaleDateString('en-GB',{month:'short',timeZone:item.timezone})}</small></div>
            <div className="admin-class-detail"><strong>{item.service_name}</strong><span>{new Intl.DateTimeFormat('en-LK',{timeZone:item.timezone,hour:'numeric',minute:'2-digit'}).format(new Date(item.starts_at))} · {item.practitioner_name}</span><small>{item.room_name||'No room'} · {item.booked}/{item.capacity} booked · {item.status}</small></div>
            {item.status==='open'&&item.booked===0&&<button type="button" className="admin-close-class" disabled={busy} aria-label={`Close ${item.service_name} class`} onClick={()=>closeClass(item)}><Ban size={17}/></button>}
          </div>):<p className="admin-empty">No upcoming classes at this branch. Publish one to make it bookable.</p>}</div>
        </div>
      </div>
    </section>}
    {view==='people'&&<section className="admin-content" aria-label="People and access">
      <div className="admin-section-head"><div><span className="admin-label">ACCOUNT CONTROL</span><h2>People & access</h2>
        <p>Create staff logins, manage permissions, and suspend accounts. Access changes end current sessions.</p></div></div>
      <div className="admin-people-layout">
        <div className="admin-panel people-list"><div className="admin-panel-head"><span className="panel-icon"><Users/></span><div><h3>Directory</h3><p>{total} account{total===1?'':'s'} match your filters</p></div></div>
          <div className="admin-search"><label><Search size={18}/><span className="sr-only">Search accounts</span>
            <input value={search} placeholder="Search name or email" onChange={e=>{setSearch(e.target.value);setOffset(0);}}/></label>
            <select aria-label="Filter by role" value={roleFilter} onChange={e=>{setRoleFilter(e.target.value as RoleFilter);setOffset(0);}}>
              <option value="all">All roles</option>{['client',...staffRoles].map(item=><option value={item} key={item}>{item[0].toUpperCase()+item.slice(1)}</option>)}</select></div>
          <div className="admin-user-list">{users.length?users.map(item=><div className={`admin-user ${selectedId===item.id?'selected':''}`} key={item.id}>
            <span className="user-avatar">{item.name.slice(0,1).toUpperCase()}</span><div className="user-meta"><strong>{item.name}{item.id===currentUserId&&<small> · You</small>}</strong><span>{item.email}</span>
              <div><span className={`role-pill ${item.role}`}>{item.role}</span><span className={`access-pill ${item.active?'active':'inactive'}`}>{item.active?'Active':'Suspended'}</span></div></div>
            <button className="admin-manage" type="button" aria-label={`Manage ${item.name}`} onClick={()=>{setSelectedId(item.id);setEditingUser({name:item.name,role:item.role,active:item.active});setNewPassword('');}}>Manage <ArrowRight size={15}/></button>
          </div>):<p className="admin-empty">No accounts match this search.</p>}</div>
          <div className="admin-pagination"><span>{total?offset+1:0}–{Math.min(offset+25,total)} of {total}</span><div>
            <button type="button" aria-label="Previous users" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}><ChevronLeft size={18}/></button>
            <button type="button" aria-label="Next users" disabled={offset+25>=total} onClick={()=>setOffset(offset+25)}><ChevronRight size={18}/></button></div></div>
        </div>
        <div className="admin-side"><div className="admin-panel"><div className="admin-panel-head"><span className="panel-icon secondary"><Plus/></span><div><h3>Add a staff account</h3><p>Set role and branch when creating access.</p></div></div>
          <form className="admin-form" onSubmit={createUser}>
            <label>Full name<input name="name" minLength={2} maxLength={100} required placeholder="Full name"/></label>
            <label>Email<input name="email" type="email" required autoComplete="off" placeholder="name@example.com"/></label>
            <label>Initial password<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" placeholder="At least 12 characters"/></label>
            <div className="admin-form-pair"><label>Role<select value={createRole} onChange={e=>{setCreateRole(e.target.value as typeof createRole);setServiceIds([]);}}>
              {staffRoles.map(item=><option value={item} key={item}>{item[0].toUpperCase()+item.slice(1)}</option>)}</select></label>
              <label>Branch<select value={createBranch} required onChange={e=>setCreateBranch(e.target.value)}>
                {catalog?.branches.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>
            {createRole==='practitioner'&&<fieldset className="admin-services"><legend>Services taught</legend>
              {catalog?.services.map(item=><label key={item.id}><input type="checkbox" checked={serviceIds.includes(item.id)} onChange={e=>setServiceIds(current=>e.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/>{item.name}</label>)}</fieldset>}
            <p className="admin-hint">Share the password privately. Email delivery is not configured in this demo.</p>
            <button className="btn primary" type="submit" disabled={busy}><Plus size={16}/> Create account</button>
          </form></div>
          {selectedUser&&<div className="admin-panel manage-panel"><div className="admin-panel-head"><span className="panel-icon"><ShieldCheck/></span><div><h3>Manage {selectedUser.name}</h3><p>{selectedUser.branch_name||'No branch'} · {selectedUser.email}</p></div></div>
            <form className="admin-form" onSubmit={saveUser}>
              <label>Display name<input required minLength={2} maxLength={100} value={editingUser.name} onChange={e=>setEditingUser({...editingUser,name:e.target.value})}/></label>
              <label>Access role<select value={editingUser.role} disabled={selectedUser.role==='practitioner'||selectedUser.id===currentUserId} onChange={e=>setEditingUser({...editingUser,role:e.target.value})}>
                {selectedUser.role==='practitioner'&&<option value="practitioner">Practitioner</option>}{accessRoles.map(item=><option value={item} key={item}>{item[0].toUpperCase()+item.slice(1)}</option>)}</select></label>
              <label>Status<select value={editingUser.active?'active':'inactive'} disabled={selectedUser.id===currentUserId} onChange={e=>setEditingUser({...editingUser,active:e.target.value==='active'})}>
                <option value="active">Active</option><option value="inactive">Suspended</option></select></label>
              <p className="admin-hint">Accounts with upcoming bookings must be resolved before access is removed.</p>
              <button className="btn primary" type="submit" disabled={busy}>Save account changes</button>
            </form>
            {selectedUser.id!==currentUserId&&<form className="admin-form admin-password-form" onSubmit={resetPassword}><h4><LockKeyhole size={17}/> Reset password</h4>
              <label>New password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="At least 12 characters"/></label>
              <button className="admin-quiet" type="submit" disabled={busy||newPassword.length<12}>Reset and sign out user</button>
            </form>}
          </div>}
        </div>
      </div>
    </section>}
      </div>
    </div>
  </main>;
}
