import React, { useState } from 'react';
import {
  ArrowRight, Bell, CalendarDays, Check, CheckCircle2, ClipboardList, Copy, Heart, HeartHandshake,
  Megaphone, MessageCircle, Share2, ShieldCheck, Sparkles, Users, WalletCards, Globe2, Send
} from 'lucide-react';
import './extra.css';

const CATEGORIES=[
  {id:'emergency',label:'Emergency & crisis',icon:Heart, tone:'rose', line:'One unexpected bill can undo a family. Emergency support keeps rent, food, and medicine covered while a household recovers.'},
  {id:'funeral',label:'Funeral & bereavement',icon:HeartHandshake, tone:'violet', line:'No family should negotiate burial costs while grieving. Shared support carries the practical weight so they can be present with each other.'},
  {id:'children',label:'Children & schooling',icon:Users, tone:'mint', line:'Uniforms, books, and transport are small amounts that decide whether a child can simply show up and learn.'},
  {id:'hall',label:'Community spaces',icon:Globe2, tone:'amber', line:'A hall is where language, faith, and belonging are passed on. Every accessible entrance is a permanent invitation.'},
  {id:'legal',label:'Legal & advocacy',icon:ClipboardList, tone:'blue', line:'Good legal guidance early prevents years of harm. Advocacy protects the people least able to argue for themselves.'},
  {id:'monthly',label:'Monthly $1 habit',icon:WalletCards, tone:'forest', line:'One dollar from 246 members each month is a predictable pool — the difference between “we will start a collection” and “we can pay today”.'}
];

const PLAN=[
  {month:'Week 1',title:'Explain the model, not the amount',body:'Post one graphic: what $1/month is, what it is not, and where last month’s pool went. One number, one link, one ask.'},
  {month:'Week 2',title:'Show a verified case from start to finish',body:'Publish the case study walkthrough: how it was verified, what the board approved, and every voucher paid out. Transparency recruits more than a campaign appeal.'},
  {month:'Week 3',title:'Make asking safe',body:'Circulate the one-page “how to ask for help” card in Urdu, Arabic, and English. Most eligible families never request support because they do not know the process.'},
  {month:'Week 4',title:'Close the loop publicly',body:'Report the month: collected, distributed, still needed. Thank donors without exposing families. Ask the community to name the next priority.'}
];

export function AwarenessPage({notify, settings={}}){
  const [paused,setPaused]=useState({});
  const [pledged,setPledged]=useState(()=>{try{return localStorage.getItem('kindred-awareness-pledge')==='1'}catch{return false}});
  const [committee,setCommittee]=useState(()=>{try{return JSON.parse(localStorage.getItem('kindred-awareness-committee')||'null')||[
    {name:'Amina Noor',role:'Community admin',area:'Sydney'},
    {name:'Javed Mir',role:'Board member',area:'Auburn'},
    {name:'Sana Latif',role:'Program reviewer',area:'Blacktown'}
  ]}catch{return []}});
  const [form,setForm]=useState({name:'',role:'Community member',area:''});

  function pledge(){
    setPledged(true);
    try{localStorage.setItem('kindred-awareness-pledge','1')}catch{}
    notify('Thank you. Your monthly $1 pledge is recorded against your membership.');
  }
  function joinCommittee(e){
    e.preventDefault();
    if(!form.name.trim()) return notify('Add your name to join the awareness committee.');
    const next=[...committee,{...form,name:form.name.trim(),area:form.area.trim()||'Community-wide'}];
    setCommittee(next);
    try{localStorage.setItem('kindred-awareness-committee',JSON.stringify(next))}catch{}
    setForm({name:'',role:'Community member',area:''});
    notify('You are on the awareness committee. You will receive the monthly plan to review.');
  }
  function shareChannel(channel){
    notify(`Awareness card prepared for ${channel}. Only public, masked information is included.`)
  }

  return <div className="subpage-shell">
    <div className="subpage-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> COMMUNITY AWARENESS · MONTHLY $1</div>
      <h1>Community support & awareness</h1><p>How the community asks, gives, and follows through — explained so a neighbour can understand it in one minute.</p></div>
      <button className="primary-button" onClick={pledge} disabled={pledged}>{pledged?<Check size={15}/>:<Heart size={15}/>}{pledged?'Pledge recorded':'Pledge my $1 / month'}</button></div>

    <section className="aware-hero panel">
      <div className="aware-hero-copy">
        <span className="aware-kicker">THE SIMPLEST PROMISE WE MAKE</span>
        <h2>$1 a month. One shared pool.<br/>Nobody has to wait for a collection to start.</h2>
        <p>Every member contributes one dollar monthly. The pool is verified, allocated by program, approved by the board, and paid out against vouchers. When a family needs help this week, the money is already there.</p>
        <div className="aware-hero-actions">
          <button className="primary-button" onClick={pledge} disabled={pledged}>{pledged?<Check size={14}/>:<Heart size={14}/>}{pledged?'You are in':'Join the monthly $1'}</button>
          <button className="cancel-button" onClick={()=>notify('A one-page explainer has been copied. Share it in the WhatsApp and Facebook groups.')}><Share2 size={14}/>Share the explainer</button>
        </div>
      </div>
      <div className="aware-hero-figures">
        <div><b>246</b><span>members contributing</span></div>
        <div><b>$246</b><span>predictable pool each month</span></div>
        <div><b>92%</b><span>of verified requests paid inside 14 days</span></div>
        <div><b>100%</b><span>voucher-linked and publicly visible</span></div>
      </div>
    </section>

    <section className="aware-section">
      <div className="aware-section-head"><h2>Six things this community supports</h2><p>Each card can be shared as-is. Tap a card to prepare a shareable message.</p></div>
      <div className="aware-categories">
        {CATEGORIES.map(cat=>{
          const Icon=cat.icon;
          const isPaused=paused[cat.id];
          return <article className={`aware-card panel ${isPaused?'paused':''}`} key={cat.id}>
            <span className={`aware-icon ${cat.tone}`}><Icon size={18}/></span>
            <h3>{cat.label}</h3>
            <p>{cat.line}</p>
            <div className="aware-card-actions">
              <button className="text-link" onClick={()=>shareChannel(cat.label)}><Share2 size={12}/>Prepare share message</button>
              <button className="aware-pause" onClick={()=>setPaused({...paused,[cat.id]:!isPaused})}>{isPaused?'Resume':'Pause'}</button>
            </div>
          </article>
        })}
      </div>
    </section>

    <section className="aware-split">
      <div className="panel aware-plan">
        <div className="aware-section-head"><h2>The monthly awareness plan</h2><p>Repeatable, one activity per week. Consistency recruits better than intensity.</p></div>
        {PLAN.map(step=><div className="aware-plan-row" key={step.month}><span>{step.month}</span><div><b>{step.title}</b><p>{step.body}</p></div><button className="text-link" onClick={()=>notify(`${step.month} activity copy prepared.`)}><Send size={12}/>Use</button></div>)}
      </div>
      <div className="panel aware-committee">
        <div className="aware-section-head"><h2>Awareness committee</h2><p>Two admins, one board member, and members from each area. Rotating, not permanent.</p></div>
        <div className="aware-committee-list">{committee.map((m,i)=><div key={`${m.name}-${i}`}><span className="aware-avatar">{m.name.slice(0,2).toUpperCase()}</span><div><b>{m.name}</b><small>{m.role} · {m.area}</small></div></div>)}</div>
        <form className="aware-join" onSubmit={joinCommittee}>
          <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Your name"/>
          <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{['Community member','Board member','Program reviewer','Community admin','Business supporter'].map(r=><option key={r}>{r}</option>)}</select>
          <input value={form.area} onChange={e=>setForm({...form,area:e.target.value})} placeholder="Area, e.g. Auburn"/>
          <button className="add-community-button"><MessageCircle size={13}/>Join committee</button>
        </form>
      </div>
    </section>

    <section className="aware-messages panel">
      <Megaphone size={18}/>
      <div>
        <b>Messages that work — and the ones that do not</b>
        <div className="aware-message-grid">
          <div className="aware-do"><span><CheckCircle2 size={13}/>Works</span><ul><li>“$1 covered 12 families’ medicine last month.”</li><li>“Here is the voucher number and the amount paid.”</li><li>“Ask for help using this card — no explanation needed at the door.”</li></ul></div>
          <div className="aware-dont"><span><Bell size={13}/>Backfires</span><ul><li>Sharing a family’s story or photo to raise funds.</li><li>Publishing amounts raised without saying what was paid out.</li><li>Framing a monthly contribution as a subscription or debt.</li></ul></div>
        </div>
      </div>
    </section>

    <section className="aware-tools">
      <div className="panel aware-tool"><Sparkles size={17}/><div><b>One-minute explainer</b><p>Four sentences, three links: how to ask, how to give, where the money went.</p></div><button className="text-link" onClick={()=>notify('Explainer card copied.')}><Copy size={12}/>Copy</button></div>
      <div className="panel aware-tool"><CalendarDays size={17}/><div><b>Monthly report night</b><p>Last Thursday of the month, 30 minutes, published as a summary even if nobody attends.</p></div><button className="text-link" onClick={()=>notify('Monthly report night added to the community calendar.')}><ArrowRight size={12}/>Add</button></div>
      <div className="panel aware-tool"><ShieldCheck size={17}/><div><b>Privacy-first storytelling</b><p>Consent is recorded before any story is used. Names stay masked across every public surface.</p></div><button className="text-link" onClick={()=>notify('Consent checklist opened for the next case story.')}><ArrowRight size={12}/>Checklist</button></div>
    </section>
  </div>;
}
