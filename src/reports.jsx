import React, { useMemo, useState } from 'react';
import {
  ArrowRight, BarChart3, CalendarDays, CheckCircle2, Clock3, Download, FileCheck2, FileText,
  FolderOpen, Globe2, HeartHandshake, Info, Search, ShieldCheck, Sparkles, WalletCards
} from 'lucide-react';
import { generateStatementPdf } from './finance.js';
import './extra.css';

const money=(v,currency='AUD')=>new Intl.NumberFormat('en-AU',{style:'currency',currency,maximumFractionDigits:2}).format(Number(v)||0);

const CADENCES=[
  {key:'daily',label:'Daily statement',detail:'Every day · default',next:'Today, 9:00 AM',state:'Generated'},
  {key:'weekly',label:'Weekly statement',detail:'Every Monday',next:'Monday, Nov 09',state:'Generated'},
  {key:'monthly',label:'Monthly statement',detail:'1st of each month',next:'Next: Dec 01, 2026',state:'Scheduled'},
  {key:'quarterly',label:'Quarterly statement',detail:'Every 3 months',next:'Next: Jan 01, 2027',state:'Scheduled'},
  {key:'yearly',label:'Yearly statement',detail:'Every January',next:'Next: Jan 01, 2027',state:'Scheduled'}
];

const CONTENTS=[
  ['Collections in period','Every contribution with its collection reference and program split.'],
  ['Case disbursements','Each payout linked to a case number and a voucher number.'],
  ['Board allocations','Approved amounts per program against the expected requirement.'],
  ['Campaign performance','Target, raised, closed date, and any surplus returned to the pool.'],
  ['Supporting documents','Count of documents on file per case, including Drive file IDs.'],
  ['Verification trail','Who verified what, and when — names masked in public exports.']
];

export function ReportsPage({notify,transactions=[],community='New Horizons',currency='AUD',setNav}){
  const [fromDate,setFromDate]=useState('2026-11-01');
  const [toDate,setToDate]=useState('2026-11-30');
  const [cadence,setCadence]=useState('monthly');
  const [history,setHistory]=useState([
    {id:'RPT-2026-11-04',cadence:'Daily',period:'04 Nov 2026',rows:6,total:5930.5,by:'Community admin'},
    {id:'RPT-2026-11-02',cadence:'Weekly',period:'27 Oct – 02 Nov 2026',rows:19,total:12480,by:'Community admin'},
    {id:'RPT-2026-10-31',cadence:'Monthly',period:'October 2026',rows:64,total:21340.75,by:'Finance admin'}
  ]);

  const periodRows=useMemo(()=>transactions.filter(r=>{
    const d=new Date(r.date);
    return Number.isNaN(d.getTime())||(d>=new Date(`${fromDate}T00:00:00`)&&d<=new Date(`${toDate}T23:59:59`));
  }),[transactions,fromDate,toDate]);

  const totals=periodRows.reduce((a,r)=>{
    const n=Number(String(r.amount||'0').replace(/[^0-9.]/g,''))||0;
    if(r.icon==='out') a.out+=n; else a.in+=n;
    return a;
  },{in:0,out:0});

  function generate(kind='period'){
    const period=`${fromDate} to ${toDate}`;
    generateStatementPdf(periodRows,{community,currency,period:`${kind[0].toUpperCase()+kind.slice(1)} · ${period}`});
    setHistory(prev=>[{id:`RPT-${Date.now().toString().slice(-6)}`,cadence:kind[0].toUpperCase()+kind.slice(1),period,rows:periodRows.length,total:totals.in+totals.out,by:'Community admin'},...prev]);
    notify('PDF report downloaded. It contains only masked, public-facing information.');
  }

  return <>
    <div className="subpage-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> AUTOMATED REPORTING · AUDIT-READY</div>
      <h1>Reports</h1><p>Generate a statement for any period, then open the detail behind it. Every figure traces back to a case, a voucher, or a document.</p></div>
      <button className="primary-button" onClick={()=>generate('custom')}><FileCheck2 size={16}/>Generate report</button></div>

    <div className="report-period panel">
      <div className="report-period-fields">
        <label className="master-field">From<input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label>
        <label className="master-field">To<input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
        <label className="master-field">Cadence<select value={cadence} onChange={e=>setCadence(e.target.value)}>{CADENCES.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
      </div>
      <div className="report-period-figures">
        <span><small>ENTRIES</small><b>{periodRows.length}</b></span>
        <span><small>COLLECTIONS</small><b>{money(totals.in,currency)}</b></span>
        <span><small>DISBURSEMENTS</small><b>{money(totals.out,currency)}</b></span>
        <button className="export-button" onClick={()=>generate(cadence)}><Download size={14}/>Download this period</button>
      </div>
    </div>

    <div className="report-cards">
      {CADENCES.map(c=><div className="report-card panel" key={c.key}>
        <div className="report-card-icon"><FileText size={18}/></div>
        <span className={`schedule-status ${c.state==='Generated'?'complete':''}`}><i/>{c.state}</span>
        <h3>{c.label}</h3><p>{c.detail}</p><div>{c.next}</div>
        <button onClick={()=>generate(c.key)}>{c.state==='Generated'?'Download statement':'Generate now'} <ArrowRight size={14}/></button>
      </div>)}
    </div>

    <div className="report-detail-grid">
      <section className="panel report-contents">
        <div className="aware-section-head"><h2>What is inside every report</h2><p>The same six sections, so a board member can compare months without re-learning the format.</p></div>
        <div className="report-content-list">{CONTENTS.map(([title,body],i)=><div key={title}><span>{String(i+1).padStart(2,'0')}</span><div><b>{title}</b><p>{body}</p></div></div>)}</div>
      </section>
      <aside className="report-links">
        <div className="panel report-link-card"><BarChart3 size={16}/><div><b>Budget & allocation detail</b><p>Expected need vs board approval vs disbursed, by program and case.</p></div><button className="text-link" onClick={()=>setNav('budgets')}>Open <ArrowRight size={12}/></button></div>
        <div className="panel report-link-card"><WalletCards size={16}/><div><b>Financials & vouchers</b><p>Voucher register, statement history, and per-transaction receipts.</p></div><button className="text-link" onClick={()=>setNav('financials')}>Open <ArrowRight size={12}/></button></div>
        <div className="panel report-link-card"><Sparkles size={16}/><div><b>Forecast & ballpark planning</b><p>Order-of-magnitude allocations so quick action is possible between cycles.</p></div><button className="text-link" onClick={()=>setNav('forecast')}>Open <ArrowRight size={12}/></button></div>
        <div className="panel report-link-card"><FolderOpen size={16}/><div><b>Supporting documents</b><p>Evidence, quotes, board packs, and vouchers attached to each case.</p></div><button className="text-link" onClick={()=>setNav('documents')}>Open <ArrowRight size={12}/></button></div>
        <div className="panel report-link-card"><HeartHandshake size={16}/><div><b>Case studies</b><p>How difficult cases were verified, approved, funded, and distributed.</p></div><button className="text-link" onClick={()=>setNav('caseStudies')}>Open <ArrowRight size={12}/></button></div>
      </aside>
    </div>

    <section className="panel report-history">
      <div className="finance-panel-head"><div><div className="panel-title-line"><h2>Statement history</h2><span className="finance-live"><i/>AUDIT LOG</span></div><p>Each generated report is recorded with its period, entry count, and requester.</p></div></div>
      <div className="finance-table-scroll"><table className="finance-table"><thead><tr><th>REPORT</th><th>CADENCE</th><th>PERIOD</th><th>ENTRIES</th><th>AMOUNT</th><th>REQUESTED BY</th></tr></thead>
        <tbody>{history.map(h=><tr key={h.id}><td>{h.id}</td><td>{h.cadence}</td><td>{h.period}</td><td>{h.rows}</td><td>{money(h.total,currency)}</td><td>{h.by}</td></tr>)}</tbody></table></div>
    </section>

    <div className="report-note"><Clock3 size={18}/><div><b>Automatic delivery is on</b><p>Anyone who requests a statement is notified as soon as their report is ready. Batch generation runs on the chosen schedule; the PDF never includes private reviewer notes.</p></div><button onClick={()=>notify('Report delivery preferences opened.')}>Manage notifications</button></div>
  </>;
}

export function SearchPage({query='',setQuery=()=>{},cases=[],setNav,notify}){
  const destinations=[
    ['awareness','Community support & awareness','Monthly $1 model and how to talk about it'],
    ['campaigns','Campaigns','Start a go-fund programme for one case'],
    ['caseStudies','Case studies','How hard cases were verified and approved'],
    ['forecast','Forecast & allocation planning','Ballpark amounts for quick action'],
    ['documents','Supporting documents','Evidence, quotes, and Drive-backed files'],
    ['budgets','Budget & allocation','Expected vs approved vs disbursed'],
    ['financials','Financials & vouchers','Voucher register and statements'],
    ['reports','Reports','Statements by cadence and period'],
    ['master','Master setup','Community, country, languages, programs'],
    ['calendar','Master calendar','Commitments, due dates, follow-ups']
  ];
  const q=query.trim().toLowerCase();
  const matchedCases=cases.filter(c=>`${c.id} ${c.title} ${c.program} ${c.area}`.toLowerCase().includes(q));
  const matchedNav=destinations.filter(([,title,desc])=>`${title} ${desc}`.toLowerCase().includes(q));
  return <div className="subpage-shell">
    <div className="subpage-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> SEARCH EVERYTHING</div><h1>Search</h1><p>Cases, campaigns, documents, budgets, and portal tools in one place.</p></div></div>
    <label className="search-page-field"><Search size={17}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Try “rent”, “ballpark”, “documents”, or a case number"/></label>
    {!q&&<div className="empty-panel panel"><Info size={18}/><p>Start typing to search across the portal.</p></div>}
    {q&&<>
      <section className="search-group panel"><h2>Cases ({matchedCases.length})</h2>
        {matchedCases.map(c=><button key={c.id} className="search-result" onClick={()=>{setNav('cases');notify(`${c.id} · open the case list and select this request.`)}}><HeartHandshake size={15}/><span><b>{c.title}</b><small>{c.id} · {c.program} · {c.area}</small></span><ArrowRight size={14}/></button>)}
        {!matchedCases.length&&<p className="search-empty">No cases match. Try a case number or a program name.</p>}
      </section>
      <section className="search-group panel"><h2>Portal tools ({matchedNav.length})</h2>
        {matchedNav.map(([key,title,desc])=><button key={key} className="search-result" onClick={()=>setNav(key)}><Globe2 size={15}/><span><b>{title}</b><small>{desc}</small></span><ArrowRight size={14}/></button>)}
        {!matchedNav.length&&<p className="search-empty">No tools match that search.</p>}
      </section>
      <div className="search-privacy"><ShieldCheck size={13}/><span>Search only covers masked public information. Private notes and reviewer identities are never indexed.</span></div>
    </>}
  </div>;
}
