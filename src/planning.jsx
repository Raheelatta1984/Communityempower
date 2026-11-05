import React, { useMemo, useState } from 'react';
import {
  ArrowRight, BadgeDollarSign, Banknote, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3,
  ExternalLink, Heart, HeartHandshake, Info, Plus, Rocket, ShieldCheck, Sparkles, Target, Users, WalletCards, X, Zap
} from 'lucide-react';
import './extra.css';

const money=(n,currency='AUD')=>new Intl.NumberFormat('en-AU',{style:'currency',currency,maximumFractionDigits:2}).format(Number(n)||0);
const pct=(n,d)=>d>0?Math.max(0,Math.min(100,Math.round(n/d*100))):0;

const SEED_CAMPAIGNS = [
  {id:'CMP-2411', title:'Emergency relocation after a house fire', caseRef:'CE-2408', program:'Emergency support fund', target:6800, raised:5140, donors:186, daysLeft:9, status:'Active', monthlyBase:246, currency:'AUD', channels:['Monthly $1 pool','GoFundMe','Business match'], story:'Two households displaced overnight need bond, temporary accommodation, and school replacements.'},
  {id:'CMP-2409', title:'Community hall access ramp', caseRef:'CE-2388', program:'Community hall', target:6000, raised:4820, donors:94, daysLeft:21, status:'Active', monthlyBase:246, currency:'AUD', channels:['Monthly $1 pool','Business match'], story:'A permanent accessible entrance so every member can attend Friday gatherings.'},
  {id:'CMP-2402', title:'Repatriation support · closed at target', caseRef:'CE-2403', program:'Funeral & burial support', target:4200, raised:4200, donors:143, daysLeft:0, status:'Funded', monthlyBase:246, currency:'AUD', channels:['Monthly $1 pool','GoFundMe'], story:'Repatriation costs following an unexpected bereavement, closed early when the visa was granted.'}
];

/* ------------------------------------------------------------------ */
/* Campaign initiation                                                 */
/* ------------------------------------------------------------------ */
export function CampaignsPage({notify,cases=[],communityName='New Horizons',currency='AUD'}){
  const [campaigns,setCampaigns]=useState(()=>{try{return JSON.parse(localStorage.getItem('kindred-campaigns')||'null')||SEED_CAMPAIGNS}catch{return SEED_CAMPAIGNS}});
  const [showForm,setShowForm]=useState(false);
  const [filter,setFilter]=useState('All');
  const [form,setForm]=useState({title:'',caseRef:'',program:'Emergency support fund',target:'',duration:'30',story:'',gofundUrl:'',monthlyBase:true,businessMatch:false});

  const persist=next=>{setCampaigns(next);try{localStorage.setItem('kindred-campaigns',JSON.stringify(next))}catch{}};
  const visible=campaigns.filter(c=>filter==='All'||c.status===filter);
  const totals=campaigns.reduce((a,c)=>({target:a.target+c.target,raised:a.raised+c.raised,donors:a.donors+c.donors}),{target:0,raised:0,donors:0});

  function createCampaign(e){
    e.preventDefault();
    if(!form.title.trim()) return notify('Give the campaign a short public title first.');
    const target=Number(form.target);
    if(!Number.isFinite(target)||target<=0) return notify('Set a campaign target greater than zero.');
    const created={
      id:`CMP-${Math.floor(Math.random()*9000+1000)}`,
      title:form.title.trim(), caseRef:form.caseRef||'Unlinked', program:form.program,
      target, raised:0, donors:0, daysLeft:Number(form.duration)||30, status:'Awaiting board approval',
      monthlyBase:form.monthlyBase?246:0, currency,
      channels:[...form.monthlyBase?['Monthly $1 pool']:[],...form.gofundUrl?['GoFundMe']:[],...form.businessMatch?['Business match']:[]],
      story:form.story.trim()||'Campaign created from the case file.'
    };
    persist([created,...campaigns]);
    setShowForm(false);
    setForm({title:'',caseRef:'',program:'Emergency support fund',target:'',duration:'30',story:'',gofundUrl:'',monthlyBase:true,businessMatch:false});
    notify(`${created.id} created as a draft campaign linked to ${created.caseRef}. Board approval opens it for collection.`);
  }
  function publish(id){persist(campaigns.map(c=>c.id===id?{...c,status:'Active'}:c));notify('Campaign published. Public link and ledger tracking are now live.')}
  function close(id){persist(campaigns.map(c=>c.id===id?{...c,status:'Closed'}:c));notify('Campaign closed. Any surplus returns to the program pool and stays visible in the ledger.')}

  return <div className="subpage-shell">
    <div className="subpage-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> CAMPAIGN INITIATION · CASE-LINKED FUNDRAISING</div>
      <h1>Campaigns</h1><p>Start a go-fund programme for a specific case, alongside — never instead of — the monthly $1 community collection.</p></div>
      <button className="primary-button" onClick={()=>setShowForm(s=>!s)}>{showForm?<X size={16}/>:<Plus size={16}/>}{showForm?'Close form':'Initiate campaign'}</button></div>

    <div className="campaign-base panel">
      <div className="campaign-base-icon"><Banknote size={20}/></div>
      <div className="campaign-base-copy"><b>The monthly $1 collection still runs first</b>
        <p>Every member’s $1 monthly contribution builds the shared program pool. A campaign is an additional top-up for one specific case when the pool alone would delay action.</p></div>
      <div className="campaign-base-figures">
        <span><small>BASE COLLECTION</small><b>$1 × 246 members</b></span>
        <span><small>THIS MONTH</small><b>{money(246,currency)}</b></span>
        <span><small>CAMPAIGN TOP-UPS</small><b>{money(totals.raised,currency)}</b></span>
      </div>
    </div>

    {showForm&&<form className="campaign-form panel" onSubmit={createCampaign}>
      <div className="campaign-form-head"><h2>Initiate a campaign</h2><p>Link it to a case so collection, approval, and disbursement stay on the same audit trail.</p></div>
      <div className="campaign-grid">
        <label className="master-field">Public campaign title<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Emergency relocation after a house fire"/></label>
        <label className="master-field">Linked case<select value={form.caseRef} onChange={e=>setForm({...form,caseRef:e.target.value})}>
          <option value="">Not linked yet</option>
          {cases.map(c=><option key={c.id} value={c.id}>{c.id} · {c.title}</option>)}</select></label>
        <label className="master-field">Program<select value={form.program} onChange={e=>setForm({...form,program:e.target.value})}>
          {['Emergency support fund','Funeral & burial support','Community hall','Legal support & advocacy'].map(p=><option key={p}>{p}</option>)}</select></label>
        <label className="master-field">Target amount<input type="number" min="1" step="1" value={form.target} onChange={e=>setForm({...form,target:e.target.value})} placeholder="6800"/><small>Keep the target to the verified gap, not the whole request.</small></label>
        <label className="master-field">Collection window (days)<input type="number" min="1" max="120" value={form.duration} onChange={e=>setForm({...form,duration:e.target.value})}/></label>
        <label className="master-field">External GoFundMe URL (optional)<input type="url" value={form.gofundUrl} onChange={e=>setForm({...form,gofundUrl:e.target.value})} placeholder="https://gofundme.com/f/…"/><small>Campaigns are collected through an approved external provider; this portal never holds card details.</small></label>
        <label className="master-field field-wide">Short public story<textarea rows="3" value={form.story} onChange={e=>setForm({...form,story:e.target.value})} placeholder="Two sentences a neighbour would understand. No names, addresses, or medical detail."/></label>
      </div>
      <div className="campaign-checks">
        <label className="campaign-check"><input type="checkbox" checked={form.monthlyBase} onChange={e=>setForm({...form,monthlyBase:e.target.checked})}/><span><b>Draw from the monthly $1 pool first</b><small>Reduces the campaign target to the remaining gap.</small></span></label>
        <label className="campaign-check"><input type="checkbox" checked={form.businessMatch} onChange={e=>setForm({...form,businessMatch:e.target.checked})}/><span><b>Invite a business match</b><small>Local businesses can match a capped amount, published on the campaign page.</small></span></label>
      </div>
      <div className="campaign-form-note"><ShieldCheck size={15}/><span>New campaigns start as drafts and need board approval. Public pages show masked names only, and every contribution must reconcile to a ledger entry.</span></div>
      <div className="campaign-form-actions"><button type="button" className="cancel-button" onClick={()=>setShowForm(false)}>Cancel</button><button type="submit" className="primary-button"><Rocket size={15}/>Create campaign</button></div>
    </form>}

    <div className="campaign-stats">
      <article><span>TOTAL CAMPAIGN TARGET</span><b>{money(totals.target,currency)}</b><small><Target size={12}/>{campaigns.length} campaigns</small></article>
      <article><span>RAISED SO FAR</span><b>{money(totals.raised,currency)}</b><small><Heart size={12}/>{totals.donors} contributions</small></article>
      <article><span>FUNDED & CLOSED</span><b>{campaigns.filter(c=>c.status==='Funded'||c.status==='Closed').length.toString().padStart(2,'0')}</b><small><CheckCircle2 size={12}/>Closed at or near target</small></article>
      <article><span>NEEDS A DECISION</span><b>{campaigns.filter(c=>c.status==='Awaiting board approval').length.toString().padStart(2,'0')}</b><small><Clock3 size={12}/>Drafts awaiting board</small></article>
    </div>

    <div className="campaign-toolbar"><div className="case-tabs">{['All','Active','Awaiting board approval','Funded','Closed'].map(f=><button key={f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{f}</button>)}</div></div>

    <div className="campaign-list">
      {visible.map(c=>{
        const progress=pct(c.raised,c.target);
        const statusClass=c.status==='Active'?'active':c.status==='Funded'?'funded':c.status==='Closed'?'closed':'draft';
        return <article className="campaign-card panel" key={c.id}>
          <div className="campaign-card-head">
            <div><span className="study-tag">{c.id} · {c.caseRef}</span><h3>{c.title}</h3><p>{c.story}</p></div>
            <span className={`campaign-status ${statusClass}`}><i/>{c.status}</span>
          </div>
          <div className="campaign-progress">
            <div className="campaign-progress-track"><i style={{width:`${progress}%`}}/></div>
            <div className="campaign-progress-labels"><b>{money(c.raised,c.currency)} <small>raised</small></b><span>{progress}% of {money(c.target,c.currency)}</span></div>
          </div>
          <div className="campaign-meta">
            <span><Users size={13}/>{c.donors} contributors</span>
            <span><CalendarDays size={13}/>{c.status==='Active'?`${c.daysLeft} days left`:'Window closed'}</span>
            <span><HeartHandshake size={13}/>{c.program}</span>
            {c.monthlyBase>0&&<span><Banknote size={13}/>Monthly pool +{money(c.monthlyBase,c.currency)}</span>}
          </div>
          <div className="campaign-channels">{c.channels.map(ch=><span key={ch}>{ch}</span>)}</div>
          <div className="campaign-actions">
            {c.status==='Awaiting board approval'&&<button className="primary-button" onClick={()=>publish(c.id)}><Rocket size={14}/>Publish after board approval</button>}
            {c.status==='Active'&&<><button className="cancel-button" onClick={()=>close(c.id)}>Close campaign</button>
              <button className="export-button" onClick={()=>notify('Public campaign link copied. Share it in the community WhatsApp and Facebook groups.')}><ExternalLink size={14}/>Share link</button></>}
            <button className="text-link" onClick={()=>notify(`${c.id} · contributions and vouchers are traceable in Financials & vouchers.`)}>Contributions & vouchers <ArrowRight size={13}/></button>
          </div>
        </article>;
      })}
      {!visible.length&&<div className="empty-panel panel"><Info size={18}/><p>No campaigns in this status yet.</p></div>}
    </div>

    <div className="campaign-rules panel">
      <Sparkles size={17}/>
      <div><b>Campaign rules the board expects</b>
        <p>1. The monthly $1 collection is always the first source. 2. A campaign only asks for the verified gap. 3. Targets never exceed the board-approved cap. 4. Surplus returns to the program pool. 5. Every contribution must reconcile to a ledger entry and every payout to a voucher.</p></div>
    </div>
  </div>;
}

/* ------------------------------------------------------------------ */
/* Ballpark forecast & allocation planning                             */
/* ------------------------------------------------------------------ */
const PROGRAM_SEED=[
  {id:'emergency-support',name:'Emergency support fund',expected:18000,approved:14000,committed:8240,ballpark:34},
  {id:'funeral-burial',name:'Funeral & burial support',expected:6000,approved:4200,committed:2300,ballpark:20},
  {id:'community-hall',name:'Community hall',expected:12000,approved:9000,committed:3500,ballpark:26},
  {id:'legal-advocacy',name:'Legal support & advocacy',expected:8000,approved:5000,committed:1200,ballpark:20}
];

export function ForecastPage({notify,currency='AUD'}){
  const [available,setAvailable]=useState(24850);
  const [reservePct,setReservePct]=useState(15);
  const [rows,setRows]=useState(PROGRAM_SEED);
  const [quickAction,setQuickAction]=useState(2500);
  const [savedAt,setSavedAt]=useState('');

  const reserve=Math.round(available*reservePct/100);
  const distributable=Math.max(0,available-reserve);
  const totalPct=rows.reduce((a,r)=>a+r.ballpark,0);

  const computed=rows.map(r=>{
    const ballpark=Math.round(distributable*r.ballpark/100);
    const remaining=Math.max(0,ballpark-r.committed);
    return {...r,ballparkAmount:ballpark,remaining,canActNow:remaining>=quickAction};
  });
  const canAct=computed.filter(r=>r.canActNow);
  const totalBallpark=computed.reduce((a,r)=>a+r.ballparkAmount,0);

  function setShare(id,value){setRows(prev=>prev.map(r=>r.id===id?{...r,ballpark:Math.max(0,Math.min(100,Number(value)||0))}:r))}
  function balance(){const share=Math.round(100/rows.length);setRows(prev=>prev.map((r,i)=>({...r,ballpark:i===prev.length-1?100-share*(prev.length-1):share})))}
  function save(){try{localStorage.setItem('kindred-ballpark',JSON.stringify({available,reservePct,quickAction,rows}))}catch{}setSavedAt(new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}));notify('Ballpark allocation plan saved. Program managers can now quote it for quick action.')}

  return <div className="subpage-shell">
    <div className="subpage-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> BALLPARK PLANNING · QUICK-ACTION READINESS</div>
      <h1>Forecast & allocation planning</h1><p>Rough-order amounts per program so a small, urgent case can be funded the same day without waiting for a full budget cycle.</p></div>
      <button className="primary-button" onClick={save}><Check size={15}/>Save ballpark plan</button></div>

    <div className="ballpark-controls panel">
      <div className="ballpark-control-grid">
        <label className="master-field">Funds available now<input type="number" min="0" step="50" value={available} onChange={e=>setAvailable(Number(e.target.value)||0)}/><small>Collected and uncommitted across the community pool.</small></label>
        <label className="master-field">Quick-action reserve ({reservePct}%)<input type="range" min="0" max="50" step="1" value={reservePct} onChange={e=>setReservePct(Number(e.target.value))}/><small>Held back so an unexpected case is never turned away for lack of a buffer.</small></label>
        <label className="master-field">Typical quick-action amount<input type="number" min="0" step="50" value={quickAction} onChange={e=>setQuickAction(Number(e.target.value))||0}/><small>A program is “quick-action ready” when its remaining ballpark covers this amount.</small></label>
      </div>
      <div className="ballpark-summary">
        <span><small>AVAILABLE</small><b>{money(available,currency)}</b></span>
        <span><small>RESERVE HELD</small><b>{money(reserve,currency)}</b></span>
        <span><small>PLANNED TO PROGRAMS</small><b>{money(totalBallpark,currency)}</b></span>
        <span className={totalPct===100?'balanced':'unbalanced'}><small>SHARE TOTAL</small><b>{totalPct}%{totalPct!==100?' · adjust shares':''}</b></span>
      </div>
    </div>

    <div className="ballpark-table panel">
      <div className="ballpark-head"><div><h2>Ballpark by program</h2><p>Move the share to change the order-of-magnitude amount. This is a planning estimate, not a board approval.</p></div>
        <button className="export-button" onClick={balance}>Even shares <CheckCircle2 size={14}/></button></div>
      <div className="ballpark-rows">
        {computed.map(r=><div className="ballpark-row" key={r.id}>
          <div className="ballpark-name"><b>{r.name}</b><small>Committed {money(r.committed,currency)} · expected need {money(r.expected,currency)}</small></div>
          <div className="ballpark-share">
            <input type="range" min="0" max="60" step="1" value={r.ballpark} onChange={e=>setShare(r.id,e.target.value)}/>
            <span>{r.ballpark}%</span>
          </div>
          <div className="ballpark-values"><span><small>BALLPARK</small><b>{money(r.ballparkAmount,currency)}</b></span>
            <span><small>REMAINING</small><b>{money(r.remaining,currency)}</b></span></div>
          <span className={`quick-flag ${r.canActNow?'ready':'short'}`}>{r.canActNow?<><Zap size={12}/>Quick action ready</>:<><Clock3 size={12}/>Needs board or campaign</>}</span>
        </div>)}
      </div>
      <div className="ballpark-foot"><ShieldCheck size={14}/><span>Forecasts are estimates and never become approvals. A real disbursement still needs a verified case, a board cap, and a voucher.</span></div>
    </div>

    <div className="ballpark-action panel">
      <div className="ballpark-action-icon"><Zap size={20}/></div>
      <div><b>{canAct.length} of {computed.length} programs can act within 24 hours</b>
        <p>A {money(quickAction,currency)} case could be paid today from: {canAct.length?canAct.map(r=>r.name).join(', '):'no program — the reserve would need board release first'}.</p></div>
      <button className="text-link" onClick={()=>notify('Quick-action request opened with the ballpark figures pre-filled.')}>Start quick action <ArrowRight size={13}/></button>
    </div>

    <div className="ballpark-cards">
      <div className="panel ballpark-card"><BadgeDollarSign size={17}/><div><b>Why a ballpark, not a budget</b><p>A full budget cycle is monthly. Emergencies are not. A published ballpark lets a program manager say “we can cover up to about $2,500 today” and still be auditable.</p></div></div>
      <div className="panel ballpark-card"><WalletCards size={17}/><div><b>Runway against committed cases</b><p>Committed means board-approved but not yet paid. Remaining is what is left inside the ballpark after those commitments.</p></div></div>
      <div className="panel ballpark-card"><ShieldCheck size={17}/><div><b>Reserve discipline</b><p>The reserve is deliberately not allocated. If a program exhausts its ballpark, the reserve needs a documented board release — not a quiet transfer.</p></div></div>
    </div>
  </div>;
}
