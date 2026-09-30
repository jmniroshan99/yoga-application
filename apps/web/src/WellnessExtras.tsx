import {useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowRight, CalendarDays, Check, Clock3, Flower2, Heart, Leaf, LogOut,
  Mail, MapPin, Pause, Play, RotateCcw, Sparkles, Sun, UserRound, Users,
  Volume2, VolumeX, Waves, Wind,
} from 'lucide-react';
import './wellness-extras.css';

export type WellnessService = {
  id: string;
  name: string;
  summary: string;
  category: string;
  kind: string;
  duration_minutes: number;
  price_cents: number;
};

export type WellnessBooking = {
  status: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
};

export type WellnessUser = {name: string; email: string; role: string};

export type ProgramsPageProps = {services: readonly WellnessService[]; onBook: (serviceId: string) => void; onExplore: () => void};
export type MeditationPageProps = {onExplore?: () => void};
export type ProgressPageProps = {bookings: readonly WellnessBooking[]; user: WellnessUser | null; onExplore: () => void};
export type CommunityPageProps = {onExplore: () => void};
export type ProfilePageProps = {bookings: readonly WellnessBooking[]; user: WellnessUser | null; onExplore: () => void; onSignOut: () => void; onSignIn?: () => void};

const meditationStorageKey = 'sahana-meditation-seconds-v1';
const meditationUpdateEvent = 'sahana-meditation-updated';

function readMeditationSeconds() {
  try {
    const value = Number(window.localStorage.getItem(meditationStorageKey));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function addMeditationSeconds(seconds: number) {
  if (seconds <= 0) return;
  try {
    window.localStorage.setItem(meditationStorageKey, String(readMeditationSeconds() + seconds));
    window.dispatchEvent(new Event(meditationUpdateEvent));
  } catch {
    // Meditation remains usable when private browsing blocks local storage.
  }
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-LK', {style: 'currency', currency: 'LKR', maximumFractionDigits: 0}).format(cents / 100);
}

function formatMinutes(seconds: number) {
  return (seconds / 60).toFixed(seconds < 600 ? 1 : 0);
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function durationMinutes(booking: WellnessBooking) {
  const minutes = (new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()) / 60000;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function displayDate(date: string, timezone = 'Asia/Colombo') {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 'Date to be confirmed';
  try {
    return new Intl.DateTimeFormat('en-LK', {timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric'}).format(parsed);
  } catch {
    return new Intl.DateTimeFormat('en-LK', {day: 'numeric', month: 'short', year: 'numeric'}).format(parsed);
  }
}

function displayTime(date: string, timezone = 'Asia/Colombo') {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-LK', {timeZone: timezone, hour: 'numeric', minute: '2-digit'}).format(parsed);
  } catch {
    return new Intl.DateTimeFormat('en-LK', {hour: 'numeric', minute: '2-digit'}).format(parsed);
  }
}

function PageKicker({children}: {children: React.ReactNode}) {
  return <span className="wellness-kicker"><Leaf size={14} strokeWidth={1.7}/>{children}</span>;
}

function SectionHeading({eyebrow, title, description}: {eyebrow: string; title: string; description?: string}) {
  return <div className="wellness-section-heading"><PageKicker>{eyebrow}</PageKicker><h2>{title}</h2>{description && <p>{description}</p>}</div>;
}

export function ProgramsPage({services, onBook, onExplore}: ProgramsPageProps) {
  const [kind, setKind] = useState('all');
  const visible = useMemo(() => kind === 'all' ? services : services.filter(service => service.kind === kind), [kind, services]);
  const filters = [{value: 'all', label: 'All practices'}, {value: 'group', label: 'Group classes'}, {value: 'private', label: 'Private sessions'}, {value: 'online', label: 'Online'}];

  return <main className="wellness-page wellness-programs">
    <section className="wellness-cover wellness-programs-cover">
      <div className="wellness-cover-copy"><PageKicker>THE PRACTICE COLLECTION</PageKicker><h1>Find your own<br/><em>way to wellbeing.</em></h1><p>Explore the real sessions offered by Sahana. Choose the kind of guidance that fits your life, your pace, and your next step.</p><button className="wellness-button wellness-button-gold" onClick={onExplore}>Browse classes <ArrowRight size={17}/></button></div>
      <div className="wellness-cover-stamp"><Flower2 size={27}/><span>Move gently<br/>Grow steadily</span></div>
    </section>

    <section className="wellness-container wellness-program-intro"><SectionHeading eyebrow="YOUR PRACTICE, YOUR PACE" title="Space to grow in your own way" description="From shared movement to one-to-one guidance, every path begins with a single session."/><div className="wellness-paths"><article><span><Users size={21}/></span><h3>Practice together</h3><p>Move with a small group and the energy of a shared intention.</p></article><article><span><Heart size={21}/></span><h3>Personal attention</h3><p>Choose focused guidance shaped around your individual needs.</p></article><article><span><Sun size={21}/></span><h3>Wherever you are</h3><p>Find a quiet moment with the online sessions in our catalog.</p></article></div></section>

    <section className="wellness-container wellness-program-list" aria-label="Available practices"><div className="wellness-list-heading"><SectionHeading eyebrow="EXPLORE THE CATALOG" title="Available practices" description="Current sessions and prices come from the Sahana studio catalog."/><div className="wellness-filter-row" role="group" aria-label="Filter practices">{filters.map(filter => <button key={filter.value} type="button" className={kind === filter.value ? 'is-active' : ''} aria-pressed={kind === filter.value} onClick={() => setKind(filter.value)}>{filter.label}</button>)}</div></div>
      {visible.length ? <div className="wellness-program-grid">{visible.map((service, index) => <article className="wellness-program-card" key={service.id}><div className={`wellness-program-art wellness-art-${index % 4}`}><span className="wellness-program-number">0{index + 1}</span><span className="wellness-program-art-icon">{service.kind === 'online' ? <Waves size={39} strokeWidth={1.2}/> : service.kind === 'group' ? <Flower2 size={42} strokeWidth={1.2}/> : <Leaf size={40} strokeWidth={1.2}/>}</span><span className="wellness-program-kind">{service.kind}</span></div><div className="wellness-program-card-body"><span className="wellness-card-category">{service.category}</span><h3>{service.name}</h3><p>{service.summary}</p><div className="wellness-program-details"><span><Clock3 size={15}/>{service.duration_minutes} minutes</span><strong>{formatMoney(service.price_cents)}</strong></div><button className="wellness-button wellness-button-forest" type="button" onClick={() => onBook(service.id)}>Choose this session <ArrowRight size={16}/></button></div></article>)}</div> : <div className="wellness-empty"><Flower2 size={31}/><h3>No sessions in this category yet</h3><p>Explore all current practices to find an available session.</p><button className="wellness-button wellness-button-outline" type="button" onClick={() => setKind('all')}>Show all practices</button></div>}
    </section>
  </main>;
}

type AmbientSound = 'none' | 'rain' | 'ocean' | 'wind';

function startAmbientSound(sound: Exclude<AmbientSound, 'none'>) {
  const context = new AudioContext();
  const buffer = context.createBuffer(1, Math.round(context.sampleRate * 2), context.sampleRate);
  const channel = buffer.getChannelData(0);
  let smooth = 0;
  for (let index = 0; index < channel.length; index++) {
    const white = Math.random() * 2 - 1;
    smooth = (smooth + (sound === 'ocean' ? .018 : .045) * white) / (sound === 'ocean' ? 1.018 : 1.045);
    channel[index] = sound === 'rain' ? white * .36 : smooth * (sound === 'ocean' ? 3.5 : 2.1);
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = sound === 'rain' ? 'highpass' : 'lowpass';
  filter.frequency.value = sound === 'rain' ? 650 : sound === 'ocean' ? 390 : 800;
  const gain = context.createGain();
  gain.gain.value = sound === 'rain' ? .055 : .1;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  let lfo: OscillatorNode | null = null;
  if (sound === 'ocean') {
    lfo = context.createOscillator();
    const movement = context.createGain();
    lfo.frequency.value = .13;
    movement.gain.value = .035;
    lfo.connect(movement);
    movement.connect(gain.gain);
    lfo.start();
  }
  source.start();
  void context.resume();
  return () => {source.stop(); lfo?.stop(); void context.close();};
}

export function MeditationPage({onExplore}: MeditationPageProps) {
  const [duration, setDuration] = useState(10 * 60);
  const [remaining, setRemaining] = useState(10 * 60);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('A quiet moment');
  const [sound, setSound] = useState<AmbientSound>('none');
  const [audioMessage, setAudioMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [localSeconds, setLocalSeconds] = useState(readMeditationSeconds);
  const endAt = useRef(0);
  const phaseStartedAt = useRef(0);
  const completed = useRef(false);
  const stopAudio = useRef<(() => void) | null>(null);

  useEffect(() => () => {stopAudio.current?.();}, []);
  useEffect(() => {
    if (!running) return;
    endAt.current = Date.now() + remaining * 1000;
    phaseStartedAt.current = Date.now();
    const interval = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setRemaining(next);
      setPhase(Math.floor((Date.now() - phaseStartedAt.current) / 4000) % 2 ? 'Breathe out' : 'Breathe in');
      if (next === 0 && !completed.current) {
        completed.current = true;
        setRunning(false);
        setPhase('Beautifully done');
        addMeditationSeconds(duration);
        setLocalSeconds(readMeditationSeconds());
        setSavedMessage(`${formatMinutes(duration)} minutes added to your practice on this device.`);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [running, duration]);

  const chooseDuration = (minutes: number) => {
    const seconds = minutes * 60;
    setRunning(false);
    setDuration(seconds);
    setRemaining(seconds);
    setPhase('A quiet moment');
    setSavedMessage('');
    completed.current = false;
  };
  const chooseSound = (next: AmbientSound) => {
    stopAudio.current?.();
    stopAudio.current = null;
    setAudioMessage('');
    if (next === 'none') {setSound('none'); return;}
    try {
      if (typeof AudioContext === 'undefined') throw new Error('Ambient audio is unavailable in this browser.');
      stopAudio.current = startAmbientSound(next);
      setSound(next);
    } catch {
      setSound('none');
      setAudioMessage('Ambient audio is unavailable in this browser. The breathing timer still works.');
    }
  };
  const toggleTimer = () => {
    if (running) {setRunning(false); setPhase('Paused'); return;}
    if (remaining === 0) setRemaining(duration);
    completed.current = false;
    setSavedMessage('');
    setRunning(true);
  };
  const finishSession = () => {
    if (completed.current) return;
    const practiced = duration - remaining;
    setRunning(false);
    setPhase('A quiet moment');
    if (practiced > 0) {
      addMeditationSeconds(practiced);
      setLocalSeconds(readMeditationSeconds());
      setSavedMessage(`${formatMinutes(practiced)} minutes added to your practice on this device.`);
    }
    setRemaining(duration);
    completed.current = true;
  };

  return <main className="wellness-page wellness-meditation">
    <section className="wellness-meditation-hero"><div className="wellness-container"><PageKicker>PAUSE. BREATHE. RETURN.</PageKicker><h1>Make room for <em>stillness.</em></h1><p>A simple guided breathing space for the moments when you need to slow down.</p></div></section>
    <div className="wellness-container wellness-meditation-grid"><section className="wellness-breath-card" aria-label="Breathing timer"><div className="wellness-breath-top"><span><Sparkles size={17}/> YOUR MOMENT</span><span>{duration / 60} minute practice</span></div><div className={`wellness-breath-orb ${running ? 'is-running' : ''}`} aria-hidden="true"><div><Leaf size={35} strokeWidth={1.2}/></div></div><p className="wellness-breath-phase" role="status">{phase}</p><time className="wellness-timer" aria-label={`${Math.floor(remaining / 60)} minutes and ${remaining % 60} seconds remaining`}>{formatClock(remaining)}</time><p className="wellness-breath-hint">Inhale for four counts. Exhale for four counts.</p><div className="wellness-timer-actions"><button className="wellness-button wellness-button-gold" type="button" onClick={toggleTimer}>{running ? <Pause size={17}/> : <Play size={17}/>} {running ? 'Pause practice' : remaining === 0 ? 'Begin again' : 'Begin practice'}</button><button className="wellness-icon-button" type="button" aria-label="Reset timer" title="Reset timer" onClick={() => chooseDuration(duration / 60)}><RotateCcw size={18}/></button></div>{duration !== remaining && remaining > 0 && <button className="wellness-finish-button" type="button" onClick={finishSession}>Finish and save this practice</button>}{savedMessage && <p className="wellness-saved" role="status"><Check size={15}/>{savedMessage}</p>}</section>
      <aside className="wellness-meditation-side"><section className="wellness-options-card"><PageKicker>SET YOUR INTENTION</PageKicker><h2>Your time, your pace</h2><p>Choose a comfortable duration. Your timer works entirely in this browser.</p><div className="wellness-duration-grid" role="group" aria-label="Meditation duration">{[5, 10, 15, 20].map(minutes => <button key={minutes} className={duration === minutes * 60 ? 'is-active' : ''} type="button" aria-pressed={duration === minutes * 60} onClick={() => chooseDuration(minutes)}>{minutes}<small>min</small></button>)}</div></section>
        <section className="wellness-options-card"><PageKicker>AMBIENT SOUND</PageKicker><h2>Set the atmosphere</h2><p>Optional sound is created in your browser. Adjust volume with your device controls.</p><div className="wellness-sound-list" role="group" aria-label="Ambient sound">{([{value: 'none', label: 'Quiet', icon: VolumeX}, {value: 'rain', label: 'Soft rain', icon: Volume2}, {value: 'ocean', label: 'Ocean', icon: Waves}, {value: 'wind', label: 'Gentle wind', icon: Wind}] as const).map(option => {const Icon = option.icon; return <button key={option.value} type="button" className={sound === option.value ? 'is-active' : ''} aria-pressed={sound === option.value} onClick={() => chooseSound(option.value)}><Icon size={19}/>{option.label}{sound === option.value && <Check size={16}/>}</button>;})}</div>{audioMessage && <p className="wellness-inline-message" role="status">{audioMessage}</p>}</section>
        <div className="wellness-meditation-note"><Flower2 size={30}/><div><strong>{formatMinutes(localSeconds)} minutes practiced</strong><p>Saved on this device only. This time is separate from your studio bookings.</p></div></div></aside></div>
    {onExplore && <section className="wellness-container wellness-continue"><span><Heart size={21}/> KEEP THE CALM GOING</span><h2>Practice feels different every day.</h2><p>When you feel ready to move, explore a real session with a Sahana practitioner.</p><button className="wellness-button wellness-button-outline" type="button" onClick={onExplore}>Explore classes <ArrowRight size={16}/></button></section>}
  </main>;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ProgressPage({bookings, user, onExplore}: ProgressPageProps) {
  const [localSeconds, setLocalSeconds] = useState(readMeditationSeconds);
  useEffect(() => {
    const refresh = () => setLocalSeconds(readMeditationSeconds());
    window.addEventListener('storage', refresh);
    window.addEventListener(meditationUpdateEvent, refresh);
    return () => {window.removeEventListener('storage', refresh); window.removeEventListener(meditationUpdateEvent, refresh);};
  }, []);
  const accountBookings = user ? bookings : [];
  const completed = accountBookings.filter(booking => booking.status === 'completed');
  const practiceMinutes = completed.reduce((sum, booking) => sum + durationMinutes(booking), 0);
  const upcoming = accountBookings.filter(booking => ['confirmed', 'pending_payment', 'pending_review'].includes(booking.status) && new Date(booking.starts_at).getTime() >= Date.now());
  const week = Array.from({length: 7}, (_, index) => {const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - 6 + index); const key = dateKey(day); const minutes = completed.filter(booking => dateKey(new Date(booking.starts_at)) === key).reduce((sum, booking) => sum + durationMinutes(booking), 0); return {key, label: new Intl.DateTimeFormat('en', {weekday: 'short'}).format(day), minutes};});
  const maxMinutes = Math.max(60, ...week.map(day => day.minutes));

  return <main className="wellness-page wellness-progress"><section className="wellness-container wellness-page-intro"><PageKicker>YOUR JOURNEY</PageKicker><h1>A little progress, <em>every day.</em></h1><p>{user ? `Welcome back, ${user.name.split(' ')[0]}. Your practice is personal. Here is what your completed Sahana sessions show.` : 'Sign in from your profile to see your studio practice. Meditation time on this device remains visible below.'}</p></section>
    <section className="wellness-container wellness-progress-content"><div className="wellness-metric-grid"><article><span><Check size={21}/></span><small>Classes completed</small><strong>{completed.length}</strong><p>Completed studio bookings</p></article><article><span><Clock3 size={21}/></span><small>Practice hours</small><strong>{(practiceMinutes / 60).toFixed(1)}</strong><p>From completed sessions</p></article><article><span><CalendarDays size={21}/></span><small>Upcoming sessions</small><strong>{upcoming.length}</strong><p>Reserved or awaiting confirmation</p></article><article><span><Flower2 size={21}/></span><small>Meditation minutes</small><strong>{formatMinutes(localSeconds)}</strong><p>Saved on this device only</p></article></div>
      <div className="wellness-progress-grid"><section className="wellness-chart-card"><div className="wellness-card-head"><div><PageKicker>THE PAST SEVEN DAYS</PageKicker><h2>Time on the mat</h2><p>Minutes from completed Sahana sessions.</p></div><span className="wellness-chart-legend"><i/> Session minutes</span></div><div className="wellness-chart" role="img" aria-label={`Completed practice minutes over the last seven days: ${week.map(day => `${day.label} ${Math.round(day.minutes)} minutes`).join(', ')}`}><div className="wellness-chart-lines" aria-hidden="true"><span/><span/><span/></div>{week.map(day => <div className="wellness-chart-day" key={day.key}><div className="wellness-chart-bar-track"><span className={day.minutes ? 'has-practice' : ''} style={{height: `${day.minutes ? Math.max(9, day.minutes / maxMinutes * 100) : 4}%`}} title={`${Math.round(day.minutes)} minutes`}/></div><strong>{day.label}</strong><small>{day.minutes ? `${Math.round(day.minutes)}m` : '—'}</small></div>)}</div>{!completed.length && <p className="wellness-chart-empty">Your chart will grow after your first completed class.</p>}</section>
        <section className="wellness-next-card"><PageKicker>COMING UP</PageKicker><h2>Your next moments</h2>{upcoming.length ? <div className="wellness-upcoming-list">{upcoming.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()).slice(0, 3).map((booking, index) => <article key={`${booking.starts_at}-${index}`}><span className="wellness-upcoming-dot"/><div><small>{displayDate(booking.starts_at, booking.timezone)} · {displayTime(booking.starts_at, booking.timezone)}</small><h3>{booking.service_name}</h3><span>{booking.status.replaceAll('_', ' ')}</span></div></article>)}</div> : <div className="wellness-upcoming-empty"><CalendarDays size={27}/><p>No upcoming sessions right now. A new beginning is always nearby.</p></div>}<button className="wellness-button wellness-button-outline" type="button" onClick={onExplore}>Explore classes <ArrowRight size={16}/></button></section></div>
      <p className="wellness-data-note"><Sparkles size={15}/> Session figures come from your bookings. Meditation time is kept in this browser and does not sync with your Sahana account.</p>
    </section>
  </main>;
}

export function CommunityPage({onExplore}: CommunityPageProps) {
  return <main className="wellness-page wellness-community"><section className="wellness-cover wellness-community-cover"><div className="wellness-cover-copy"><PageKicker>THE SAHANA COMMUNITY</PageKicker><h1>Belong to<br/><em>your practice.</em></h1><p>Wellbeing grows in welcoming spaces. Come as you are, move at your pace, and share the room with others finding their balance.</p><button className="wellness-button wellness-button-gold" type="button" onClick={onExplore}>Find a class <ArrowRight size={17}/></button></div><div className="wellness-cover-stamp"><Users size={26}/><span>Every body<br/>belongs</span></div></section>
    <section className="wellness-container wellness-community-values"><SectionHeading eyebrow="A SPACE TO CONNECT" title="The practice is better together" description="Join a real studio session and experience the support of a shared practice."/><div className="wellness-value-grid"><article><span><Flower2 size={25}/></span><h3>Begin as you are</h3><p>You do not need to arrive with experience. Bring curiosity and leave space for your own pace.</p></article><article><span><Users size={25}/></span><h3>Move alongside others</h3><p>Our group sessions make room for mindful movement and the simple joy of showing up together.</p></article><article><span><Heart size={25}/></span><h3>Feel supported</h3><p>Practitioners guide each session with care, attention, and respect for different needs.</p></article></div></section>
    <section className="wellness-container wellness-community-cta"><div><PageKicker>TAKE THE FIRST STEP</PageKicker><h2>Your place in the room is waiting.</h2><p>See the sessions currently available at Sahana and choose a time that feels right.</p></div><button className="wellness-button wellness-button-gold" type="button" onClick={onExplore}>Explore group classes <ArrowRight size={17}/></button></section>
  </main>;
}

export function ProfilePage({bookings, user, onExplore, onSignOut, onSignIn}: ProfilePageProps) {
  const accountBookings = user ? bookings : [];
  const completed = accountBookings.filter(booking => booking.status === 'completed').length;
  const upcoming = accountBookings.filter(booking => ['confirmed', 'pending_payment', 'pending_review'].includes(booking.status) && new Date(booking.starts_at).getTime() >= Date.now()).length;
  const initials = user?.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'SY';

  return <main className="wellness-page wellness-profile"><section className="wellness-container wellness-page-intro"><PageKicker>YOUR SPACE</PageKicker><h1>Made for <em>your journey.</em></h1><p>Your account and practice details, gathered in one calm place.</p></section><div className="wellness-container wellness-profile-grid"><section className="wellness-profile-card"><div className="wellness-profile-banner"><Leaf size={25}/><span>SAHANA YOGA</span></div><div className="wellness-profile-avatar" aria-hidden="true">{initials}</div><div className="wellness-profile-identity"><h2>{user?.name || 'Your Sahana profile'}</h2><p>{user ? 'Your practice, your pace.' : 'Sign in to see your account details.'}</p></div>{user && <div className="wellness-profile-facts"><div><UserRound size={19}/><span><small>Name</small><strong>{user.name}</strong></span></div><div><Mail size={19}/><span><small>Email address</small><strong>{user.email}</strong></span></div><div><MapPin size={19}/><span><small>Account access</small><strong>{user.role.replaceAll('_', ' ')}</strong></span></div></div>}{user ? <button className="wellness-button wellness-button-outline wellness-signout" type="button" onClick={onSignOut}><LogOut size={17}/> Sign out</button> : onSignIn && <button className="wellness-button wellness-button-forest wellness-signout" type="button" onClick={onSignIn}>Sign in <ArrowRight size={16}/></button>}</section>
      <div className="wellness-profile-side"><section className="wellness-profile-practice"><PageKicker>YOUR PRACTICE</PageKicker><h2>Every session counts.</h2><p>A simple view of the Sahana bookings connected to your account.</p><div className="wellness-profile-stats"><div><strong>{completed}</strong><span>Completed sessions</span></div><div><strong>{upcoming}</strong><span>Upcoming sessions</span></div></div><button className="wellness-button wellness-button-forest" type="button" onClick={onExplore}>Explore more classes <ArrowRight size={16}/></button></section><section className="wellness-profile-message"><Sun size={26}/><div><h3>Come back to yourself.</h3><p>There is always room for a breath, a stretch, and a fresh beginning.</p></div></section></div></div></main>;
}
