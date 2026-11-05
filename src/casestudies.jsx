import React, { useMemo, useState } from 'react';
import {
  ArrowRight, CalendarDays, CheckCircle2, ChevronDown, FileText, Handshake, HeartHandshake,
  MapPin, Search, ShieldCheck, Users, WalletCards, Banknote, ClipboardList, MessageSquare, Scale
} from 'lucide-react';
import './extra.css';

// Narrative walkthrough used by every case study. The order mirrors how a complex case
// actually travels: understand the need, verify it, present it, get it agreed, collect, distribute.
export const CASE_STUDY_STEPS = [
  {key:'situation', label:'The situation', short:'What happened', icon:ClipboardList,
   prompt:'Plain-language summary of the need, who it affected, and why routine support was not enough.'},
  {key:'approach', label:'How we approached it', short:'Approach', icon:Handshake,
   prompt:'Who took the lead, which program it sat under, and the first three things the team did.'},
  {key:'verification', label:'How we verified it', short:'Verification', icon:ShieldCheck,
   prompt:'Documents seen, people spoken to, independent checks, and what we deliberately did not accept.'},
  {key:'board', label:'How we presented it to the board', short:'Board pack', icon:FileText,
   prompt:'The one-page case summary, the numbers, the risks, and the question we asked the board to decide.'},
  {key:'decision', label:'What made the board agree to review it', short:'Board decision', icon:Scale,
   prompt:'The conditions board members attached, the limits set, and the reporting they asked for.'},
  {key:'fundraising', label:'How we collected the funds', short:'Collection', icon:Banknote,
   prompt:'Monthly $1 base, the campaign top-up, donor channels, and how the total was reconciled.'},
  {key:'distribution', label:'How we distributed the funds', short:'Distribution', icon:WalletCards,
   prompt:'Voucher-by-voucher release, who received what, and the evidence filed for each payment.'}
];

const CASE_STUDIES = [
  {
    id:'CS-2026-04', title:'Emergency relocation after a house fire', program:'Emergency support fund',
    area:'Auburn, NSW', country:'Australia', scale:'Complex · cross-program', duration:'34 days',
    requested:12400, collected:13180, distributed:11850, households:2, beneficiaries:9,
    tags:['Housing','Emergency','Verified documents'],
    summary:'Two families sharing a rental lost everything in an overnight fire. Insurance covered the structure but not immediate living costs, school items, or bond for a replacement rental.',
    steps:{
      situation:'At 2am a kitchen fire displaced nine people across two households. The landlord’s insurance covered repairs only. The families needed bond, temporary accommodation for 11 nights, school replacements, and basic household goods — none of which the standard emergency grant could cover in one release.',
      approach:'The emergency support lead paired with the funeral & burial coordinator because one household had also lost a family member in the same week. We opened a single parent case with two linked sub-cases, kept one case number for the audit trail, and assigned a single point of contact so neither family had to retell their story to a new volunteer.',
      verification:'We sighted the fire brigade incident report, the tenancy termination notice, two school enrolment confirmations, and the insurer’s written confirmation that contents were not covered. Two community reviewers independently visited the temporary accommodation. We did not accept screenshots of bank balances and we did not request medical records — neither was needed to decide the case.',
      board:'A two-page board pack went out 36 hours after the request: one page of circumstance with names masked, one page of numbers — requested vs. program balance vs. what the monthly collection could realistically cover in that cycle. The pack listed three options: fund in full, fund essentials only, or fund essentials plus a campaign for the remainder. The board was asked one question: which option, and at what cap.',
      decision:'The board approved essentials in full ($6,400) with a $5,000 cap on the balance, conditional on a public campaign and a written update at day 14. What made agreement possible was the pack being decision-shaped rather than descriptive: a clear cap, a clear condition, and a clear reporting date. Board members also cited the verified brigade report and the insurer’s note as the two documents that removed doubt.',
      fundraising:'The monthly $1 collection covered $6,400 immediately. A dedicated campaign raised the remaining $6,780 from 214 supporters over 19 days, including two local businesses who matched $1,500. We published the running total weekly, named no donors without consent, and closed the campaign at target rather than leaving it open.',
      distribution:'Funds moved in seven voucher-backed releases: bond ($3,200), temporary accommodation ($2,310), school replacements ($840), household goods ($1,450), food and transport ($1,150), plus two adjustments. Every release has a voucher number, a case reference, and a receipt on file. $1,330 of campaign surplus went back to the emergency pool and is visible in the ledger.'
    },
    timeline:[['Day 0','Request received · initial contact within 4 hours'],['Day 3','Verification complete · board pack issued'],['Day 4','Board decision: essentials approved, cap set'],['Day 8','Campaign published · first vouchers released'],['Day 27','Campaign closed at target'],['Day 34','Final disbursement · case closed and published']],
    lessons:['A single point of contact mattered more than speed of payment.','Decision-shaped board packs cut approval time from 9 days to 4.','Capping the balance before fundraising protected the program pool.']
  },
  {
    id:'CS-2026-03', title:'Funeral, repatriation, and 11-month family follow-up', program:'Funeral & burial support',
    area:'Liverpool, NSW', country:'Australia / Pakistan', scale:'Cross-border · sensitive', duration:'11 months',
    requested:19800, collected:20450, distributed:19720, households:1, beneficiaries:5,
    tags:['Cross-border','Repatriation','Sensitive'],
    summary:'A sole earner died unexpectedly. The family requested help with funeral costs, repatriation, and ongoing support for three school-aged children while the widow’s visa status was resolved.',
    steps:{
      situation:'The family could cover the local funeral but not repatriation, and had no income while a partner visa application was pending. Requests like this fail when they are treated as one lump sum, so we split it into three decisions: funeral now, repatriation in six weeks, and a recurring monthly plan for the children.',
      approach:'We involved the legal support & advocacy program from day one because the visa timeline determined what support was lawful and what would have been duplication. The family was assigned a female case lead at their request, and all contact happened through one WhatsApp thread with a written summary after every call.',
      verification:'We verified the death certificate, the repatriation quotation from an approved funeral director, three school enrolment letters, and the migration agent’s written timeline for the visa decision. We did not ask for the widow’s medical or mental-health records. The community reviewer who signed off was outside the family’s friendship circle.',
      board:'The board pack had a one-page sensitivity note explaining why three separate decisions were being requested rather than one. It showed the repatriation quote line by line and stated plainly that the monthly plan would be re-reviewed each month, not auto-approved for eleven months.',
      decision:'Board approved funeral costs immediately, repatriation at quote value, and a monthly plan capped at six installments with a mandatory monthly check-in. Board members later said the segregation of the three decisions was the reason they could agree quickly — no single approval carried all the risk.',
      fundraising:'Repatriation was funded from the funeral program pool plus a targeted campaign circulated through two community WhatsApp groups and the Facebook group. The monthly $1 collection covered the recurring installments. 143 donors contributed, with 38 recurring monthly givers.',
      distribution:'Nine voucher-backed releases including the funeral director invoice, airline repatriation, and eight monthly installments (the plan closed one month early when the visa was granted). Each installment created a new case number so the audit trail never collapses into one large payment, and the final check-in was recorded in the case file.'
    },
    timeline:[['Day 0','Sensitive intake · female case lead assigned'],['Day 2','Documents verified · legal review started'],['Day 5','Board approves three separate decisions'],['Day 41','Repatriation completed'],['Month 2–10','Monthly installments, each a new case'],['Month 11','Plan closed early · visa granted']],
    lessons:['Splitting one request into three decisions made approval possible.','A recurring plan needs a monthly re-review, not an annual approval.','Cross-program coordination prevented duplicate payments.']
  },
  {
    id:'CS-2026-01', title:'Community hall access ramp for a wheelchair user', program:'Community hall',
    area:'Blacktown, NSW', country:'Australia', scale:'Capital · co-funded', duration:'5 months',
    requested:46000, collected:48200, distributed:45700, households:0, beneficiaries:180,
    tags:['Accessibility','Capital works','Co-funded'],
    summary:'A regular hall user could no longer attend Friday gatherings. The request started as a personal accessibility need and became a capital works project benefiting roughly 180 members.',
    steps:{
      situation:'The hall entrance had three steps. A member using a wheelchair had stopped attending. The request arrived as a personal support request for transport alternatives, which would have cost more per year than a permanent ramp.',
      approach:'Rather than approving ongoing transport, the program manager reframed the request as a capital works proposal and brought in the hall committee. We costed three options: a temporary ramp, a permanent compliant ramp, and a full entrance rebuild. Each had a different funding path.',
      verification:'We obtained two independent quotes for the compliant ramp, a council accessibility assessment, and written confirmation from the hall’s insurer that the modification would not affect cover. The member’s needs were documented in their own words, with their consent, and no medical evidence was requested.',
      board:'The board pack was a single comparison table of the three options with per-year cost, lead time, and who else could use the result. It also stated what the community would need to fund if the board declined: an estimated $2,400/year in transport support.',
      decision:'Board approved the permanent compliant ramp up to $42,000 with a $6,000 community co-funding requirement, and asked for a completion report plus an accessibility audit at handover. The comparison table made the cost of saying no visible, which is what moved the decision.',
      fundraising:'A capital campaign ran for eleven weeks with three funding streams: $18,000 from the monthly collection surplus, $16,000 from businesses, and $14,200 from individual supporters. Hall committee members hosted two fundraising evenings. Progress was published with a physical thermometer in the hall as well as on the portal.',
      distribution:'Four voucher-backed releases: builder deposit, mid-build progress payment, final invoice on practical completion, and a $1,500 contingency for handrail adjustments. The council accessibility certificate and insurer acknowledgement are attached to the final voucher.'
    },
    timeline:[['Month 1','Reframed from transport support to capital works'],['Month 2','Two quotes and council assessment obtained'],['Month 3','Board approves with co-funding condition'],['Month 4','Capital campaign runs 11 weeks'],['Month 5','Build, handover, accessibility audit']],
    lessons:['Reframing a recurring cost as a capital project changed the decision.','Showing the cost of declining made the trade-off explicit.','A completion certificate is as important as the voucher itself.']
  }
];

const money = n => new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(n||0);

function StudyDetail({study, onBack, notify}){
  const [openStep, setOpenStep] = useState('situation');
  return <div className="study-detail">
    <button className="text-link study-back" onClick={onBack}>← All case studies</button>
    <div className="study-hero panel">
      <div className="study-hero-main">
        <span className="study-tag">{study.id} · {study.scale}</span>
        <h2>{study.title}</h2>
        <p>{study.summary}</p>
        <div className="study-meta">
          <span><MapPin size={13}/>{study.area}</span>
          <span><HeartHandshake size={13}/>{study.program}</span>
          <span><CalendarDays size={13}/>{study.duration}</span>
          <span><Users size={13}/>{study.households?`${study.households} households · `:''}{study.beneficiaries} people</span>
        </div>
        <div className="study-tags">{study.tags.map(t=><span key={t}>{t}</span>)}</div>
      </div>
      <div className="study-hero-money">
        {[['Requested',study.requested],['Collected',study.collected],['Distributed',study.distributed]].map(([label,value])=>
          <div key={label}><span>{label.toUpperCase()}</span><b>{money(value)}</b></div>)}
        <div className="study-balance"><span>UNSPENT / RETURNED</span><b>{money(study.collected-study.distributed)}</b></div>
        <button className="primary-button study-share" onClick={()=>notify('Case study summary copied for board circulation.')}><FileText size={14}/>Share summary</button>
      </div>
    </div>

    <div className="study-walkthrough">
      <div className="study-walk-grid">
        {CASE_STUDY_STEPS.map((step,index)=>{
          const Icon = step.icon;
          const open = openStep===step.key;
          return <article key={step.key} className={`study-step panel ${open?'open':''}`}>
            <button className="study-step-head" onClick={()=>setOpenStep(open?'':step.key)}>
              <span className="study-step-num">{String(index+1).padStart(2,'0')}</span>
              <span className="study-step-icon"><Icon size={16}/></span>
              <span className="study-step-title"><b>{step.label}</b><small>{step.prompt}</small></span>
              <ChevronDown size={16} className="study-step-chevron"/>
            </button>
            {open&&<div className="study-step-body"><p>{study.steps[step.key]}</p></div>}
          </article>
        })}
      </div>
      <aside className="study-side">
        <div className="panel study-timeline">
          <h3>How it moved</h3>
          {study.timeline.map(([when,what])=><div className="study-timeline-row" key={when}><span>{when}</span><p>{what}</p></div>)}
        </div>
        <div className="panel study-lessons">
          <h3>What we would repeat</h3>
          <ul>{study.lessons.map(l=><li key={l}><CheckCircle2 size={13}/>{l}</li>)}</ul>
        </div>
      </aside>
    </div>
  </div>;
}

export function CaseStudiesPage({notify}){
  const [query,setQuery]=useState(''); const [program,setProgram]=useState('All programs'); const [open,setOpen]=useState(null);
  const programs = useMemo(()=>['All programs',...new Set(CASE_STUDIES.map(s=>s.program))],[]);
  const list = CASE_STUDIES.filter(s=>(program==='All programs'||s.program===program)&&`${s.title} ${s.summary} ${s.tags.join(' ')} ${s.area}`.toLowerCase().includes(query.toLowerCase()));
  if(open){const study=CASE_STUDIES.find(s=>s.id===open);return <div className="subpage-shell"><CaseStudyDetailHeader/><StudyDetail study={study} onBack={()=>setOpen(null)} notify={notify}/></div>}
  return <div className="subpage-shell">
    <div className="subpage-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> LEARNING FROM HARD CASES</div><h1>Case studies</h1><p>How bigger and more challenging cases were approached, verified, presented to the board, funded, and distributed.</p></div>
      <div className="study-header-controls"><label className="inline-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search case studies"/></label>
      <select className="study-program-filter" value={program} onChange={e=>setProgram(e.target.value)}>{programs.map(p=><option key={p}>{p}</option>)}</select></div>
    </div>
    <div className="study-legend panel">
      <MessageSquare size={16}/>
      <div><b>Every case study follows the same seven questions.</b><p>Situation → approach → verification → board presentation → what made the board agree to review → how funds were collected → how funds were distributed. Copy the structure when you write up a new case.</p></div>
    </div>
    <div className="study-cards">
      {list.map(study=><article className="study-card panel" key={study.id}>
        <div className="study-card-top"><span className="study-tag">{study.id}</span><span className="study-scale">{study.scale}</span></div>
        <h3>{study.title}</h3><p className="study-card-summary">{study.summary}</p>
        <div className="study-card-tags">{study.tags.map(t=><span key={t}>{t}</span>)}</div>
        <div className="study-card-money">
          {[['Asked',study.requested],['Collected',study.collected],['Distributed',study.distributed]].map(([l,v])=><span key={l}><small>{l}</small><b>{money(v)}</b></span>)}
        </div>
        <div className="study-card-foot"><span><MapPin size={12}/>{study.area}</span><strong>{study.duration}</strong></div>
        <button className="study-open" onClick={()=>setOpen(study.id)}>Read the full walkthrough <ArrowRight size={14}/></button>
      </article>)}
    </div>
  </div>;
}

function CaseStudyDetailHeader(){
  return <div className="subpage-header compact-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> CASE STUDY WALKTHROUGH</div><h1>How this case was handled</h1></div></div>;
}
