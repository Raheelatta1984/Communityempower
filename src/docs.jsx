import React, { useEffect, useMemo, useState } from 'react';
import {
  CloudUpload, Check, CheckCircle2, Clock3, Download, ExternalLink, FileText, FolderOpen,
  HardDrive, Info, Link2, LockKeyhole, Plus, Search, ShieldCheck, Trash2, Upload, Vote, X, Users, AlertTriangle
} from 'lucide-react';
import './extra.css';

/* ------------------------------------------------------------------ */
/* Single-vote guard                                                   */
/* ------------------------------------------------------------------ */
const VOTE_KEY = 'kindred-votes-by-member';
// A vote is one per member per case, forever — not per browser session.
// The local store is the offline mirror; the database is the source of truth.
export function loadVotes(memberId='guest'){
  try{
    const all=JSON.parse(localStorage.getItem(VOTE_KEY)||'{}');
    if(all[memberId]) return all[memberId];
    // Legacy flat store from an earlier build: attribute it to the first member seen.
    const legacy=JSON.parse(localStorage.getItem('kindred-votes')||'{}');
    return legacy && typeof legacy==='object' && !Object.values(legacy).some(v=>v&&v.member)?seedLegacy(all,memberId,legacy):{};
  }catch{return {}}
}
function seedLegacy(all,memberId,legacy){
  if(!Object.keys(legacy).length) return {};
  try{localStorage.setItem(VOTE_KEY,JSON.stringify({...all,[memberId]:legacy}))}catch{}
  return legacy;
}
export function persistVote(vote,caseId,memberId='guest'){
  let all={};
  try{ all=JSON.parse(localStorage.getItem(VOTE_KEY)||'{}') }catch{ all={} }
  const mine={...(all[memberId]||{}),[caseId]:vote};
  try{ localStorage.setItem(VOTE_KEY,JSON.stringify({...all,[memberId]:mine})) }catch{}
  return mine;
}
export async function submitVote(memberId,caseId){
  try{
    const r=await fetch(`/api/public/cases/${encodeURIComponent(caseId)}/vote`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({memberId,vote:'support'})
    });
    if(r.status===409) return {status:'duplicate'};
    if(r.ok) return {status:'recorded'};
    if(r.status===403||r.status===503) return {status:'demo'};
    return {status:'offline'};
  }catch{ return {status:'offline'} }
}

export function VoteButton({caseId,votes,onVote,onWarn,label='Support this case',className='vote-button'}){
  const cast=votes[caseId];
  const locked=!!cast;
  return <button
    className={`${className} ${locked?'voted vote-locked':''}`}
    disabled={locked}
    aria-disabled={locked}
    title={locked?`You voted on ${new Date(cast.at).toLocaleString('en-AU')}. One vote per member, per case.`:'Cast your single vote for this case'}
    onClick={()=>{if(locked){onWarn?.(caseId);return}onVote(caseId)}}>
    {locked?<CheckCheckIcon/>:<Vote size={14}/>}
    {locked?'Vote recorded':label}
  </button>;
}
function CheckCheckIcon(){return <Check size={14}/>}

/* ------------------------------------------------------------------ */
/* Documents & Google Drive                                            */
/* ------------------------------------------------------------------ */
const DOC_TYPES=['Case evidence','Identity / verification','Quote or invoice','Voucher or receipt','Board pack','Campaign material','Other'];
const SEED_DOCS=[
  {id:'DOC-1041',name:'fire-brigade-incident-report.pdf',size:284000,kind:'pdf',caseRef:'CE-2408',type:'Case evidence',owner:'Emergency program lead',added:'2026-11-03',drive:'saved',driveId:'1AbCdEf1122',sensitive:false},
  {id:'DOC-1039',name:'insurer-contents-not-covered.pdf',size:132000,kind:'pdf',caseRef:'CE-2408',type:'Quote or invoice',owner:'Emergency program lead',added:'2026-11-03',drive:'saved',driveId:'1AbCdEf2233',sensitive:false},
  {id:'DOC-1034',name:'board-pack-CE-2408.pdf',size:410000,kind:'pdf',caseRef:'CE-2408',type:'Board pack',owner:'Board secretary',added:'2026-11-02',drive:'saved',driveId:'1AbCdEf3344',sensitive:true},
  {id:'DOC-1028',name:'repatriation-quote-2026-03.pdf',size:96000,kind:'pdf',caseRef:'CE-2403',type:'Quote or invoice',owner:'Funeral program lead',added:'2026-10-28',drive:'pending',driveId:'',sensitive:false},
  {id:'DOC-1022',name:'voucher-CE-2405-D.pdf',size:64000,kind:'pdf',caseRef:'CE-2405',type:'Voucher or receipt',owner:'Finance admin',added:'2026-10-24',drive:'saved',driveId:'1AbCdEf4455',sensitive:false}
];

function prettySize(bytes){
  if(!bytes) return '—';
  if(bytes<1024) return `${bytes} B`;
  if(bytes<1024*1024) return `${Math.round(bytes/1024)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}
function fileKind(name,type=''){
  if(type.includes('pdf')||name.endsWith('.pdf')) return 'pdf';
  if(type.includes('image')||/\.(png|jpe?g|webp|gif|heic)$/i.test(name)) return 'image';
  if(/\.(xlsx?|csv)$/i.test(name)) return 'sheet';
  if(/\.(docx?|txt|rtf)$/i.test(name)) return 'doc';
  return 'other';
}

export function DocumentsPage({notify,cases=[],settings={},setSettings=()=>{}}){
  const [documents,setDocuments]=useState(()=>{try{return JSON.parse(localStorage.getItem('kindred-documents')||'null')||SEED_DOCS}catch{return SEED_DOCS}});
  const [files,setFiles]=useState(()=>{try{return JSON.parse(localStorage.getItem('kindred-document-files')||'{}')}catch{return {}}});
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('All documents');
  const [showForm,setShowForm]=useState(false);
  const [form,setForm]=useState({caseRef:'',type:'Case evidence',notes:'',saveToDrive:true,sensitive:false});
  const [pending,setPending]=useState([]);
  const drive=settings.driveAccount||'';

  useEffect(()=>{try{localStorage.setItem('kindred-documents',JSON.stringify(documents))}catch{}},[documents]);
  useEffect(()=>{try{localStorage.setItem('kindred-document-files',JSON.stringify(files))}catch{}},[files]);

  const visible=documents.filter(d=>(filter==='All documents'||d.drive===filter)&&`${d.name} ${d.caseRef} ${d.type} ${d.owner}`.toLowerCase().includes(query.toLowerCase()));
  const savedCount=documents.filter(d=>d.drive==='saved').length;
  const pendingCount=documents.filter(d=>d.drive==='pending').length;

  function pickFiles(event){
    const chosen=Array.from(event.target.files||[]);
    if(!chosen.length) return;
    if(chosen.some(f=>f.size>10*1024*1024)) return notify('Each document must be smaller than 10 MB. Split large board packs before uploading.');
    setPending(chosen.map(f=>({file:f,name:f.name,size:f.size,kind:fileKind(f.name,f.type)})));
    setShowForm(true);
  }

  function attach(e){
    e.preventDefault();
    if(!pending.length) return notify('Choose at least one file first.');
    if(!form.caseRef) return notify('Link the document to a case — unlinked evidence cannot be audited.');
    const created=pending.map((p,i)=>({
      id:`DOC-${Math.floor(Math.random()*9000+1000)}${i}`,
      name:p.name,size:p.size,kind:p.kind,
      caseRef:form.caseRef,type:form.type,owner:'Amina Noor · community admin',
      added:new Date().toISOString().slice(0,10),
      drive:form.saveToDrive&&drive?'pending':'local',
      driveId:'',sensitive:form.sensitive,notes:form.notes.trim()
    }));
    // Small files (under 512 KB) are kept so they can be re-downloaded after a reload.
    const small=pending.filter(p=>p.size<512*1024);
    if(small.length){
      let read=0;
      small.forEach(p=>{
        const reader=new FileReader();
        reader.onload=()=>{
          read+=1;
          setFiles(prev=>({...prev,[p.name]:reader.result}));
        };
        reader.readAsDataURL(p.file);
      });
    }
    setDocuments(prev=>[...created,...prev]);
    setPending([]); setShowForm(false);
    setForm({caseRef:'',type:'Case evidence',notes:'',saveToDrive:true,sensitive:false});
    notify(created.length===1?`${created[0].name} attached to ${form.caseRef}.`:`${created.length} documents attached to ${form.caseRef}.`);
  }

  function sendToDrive(id){
    if(!drive) return notify('Connect a Google Drive account in Master setup before saving to Drive.');
    notify('Saving to Google Drive…');
    setTimeout(()=>{
      setDocuments(prev=>prev.map(d=>d.id===id?{...d,drive:'saved',driveId:`1Local${Math.random().toString(36).slice(2,9)}`}:d));
      notify('Saved to Google Drive. The Drive file ID is stored with the case record.');
    },700);
  }
  function download(doc){
    const data=files[doc.name];
    if(!data) return notify(`${doc.name} · the original file is not held in this browser. Open it from Google Drive.`);
    const a=document.createElement('a'); a.href=data; a.download=doc.name; a.click();
    notify(`Downloading ${doc.name}.`);
  }
  function remove(id){
    const doc=documents.find(d=>d.id===id);
    setDocuments(prev=>prev.filter(d=>d.id!==id));
    notify(`${doc?.name||'Document'} removed from the case file. Drive copies follow your retention policy.`);
  }
  function connectDrive(){
    const account='community@pcia-au.org';
    setSettings({...settings,driveAccount:account,driveFolder:'Kindred / Case files'});
    notify(`Google Drive connected as ${account}. New attachments will save to “Kindred / Case files”.`);
  }

  return <div className="subpage-shell">
    <div className="subpage-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> CASE EVIDENCE · DRIVE-BACKED STORAGE</div>
      <h1>Supporting documents</h1><p>Attach verification evidence, quotes, board packs, and vouchers to a case. Files can be saved straight into your Google Drive account.</p></div>
      <div className="doc-header-actions">
        <label className="primary-button file-trigger"><Upload size={15}/>Attach documents<input type="file" multiple onChange={pickFiles}/></label>
      </div></div>

    <div className={`drive-card panel ${drive?'connected':''}`}>
      <div className="drive-icon"><DriveIcon/></div>
      <div className="drive-copy">
        <b>{drive?`Google Drive connected · ${drive}`:'No Google Drive account connected'}</b>
        <p>{drive?`New attachments save to “${settings.driveFolder||'Kindred / Case files'}”. Files stay private to the community's Drive; the portal stores only the file ID and metadata.`:'Connect a community Google account once, then every attachment can be saved to Drive with a single click. The portal never stores your Drive password.'}</p>
        {drive&&<span className="drive-folder"><FolderOpen size={13}/>{settings.driveFolder||'Kindred / Case files'}</span>}
      </div>
      <div className="drive-actions">
        {!drive&&<button className="primary-button" onClick={connectDrive}><Link2 size={14}/>Connect Google Drive</button>}
        {drive&&<button className="cancel-button" onClick={()=>{setSettings({...settings,driveAccount:'',driveFolder:''});notify('Google Drive disconnected. Existing file references are kept.')}}>Disconnect</button>}
        <small><LockKeyhole size={11}/>Scopes requested: drive.file only</small>
      </div>
    </div>

    {showForm&&<form className="doc-form panel" onSubmit={attach}>
      <div className="doc-form-head"><h2>Attach {pending.length} document{pending.length===1?'':'s'}</h2><button type="button" className="icon-button" onClick={()=>{setShowForm(false);setPending([])}}><X size={17}/></button></div>
      <div className="doc-file-list">{pending.map(p=><div key={p.name} className="doc-file-row"><span className={`doc-kind ${p.kind}`}><FileText size={15}/></span><b>{p.name}</b><small>{prettySize(p.size)}</small></div>)}</div>
      <div className="doc-form-grid">
        <label className="master-field">Linked case<select value={form.caseRef} onChange={e=>setForm({...form,caseRef:e.target.value})}>
          <option value="">Select a case</option>
          {cases.length?cases.map(c=><option key={c.id} value={c.id}>{c.id} · {c.title}</option>):<option value="CE-2408">CE-2408 · Emergency rent support</option>}
        </select></label>
        <label className="master-field">Document type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{DOC_TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
        <label className="master-field field-wide">Reviewer note (private)<textarea rows="2" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="What this document proves, and who checked it."/></label>
      </div>
      <div className="doc-checks">
        <label className="campaign-check"><input type="checkbox" checked={form.saveToDrive} onChange={e=>setForm({...form,saveToDrive:e.target.checked})}/><span><b>Save a copy to Google Drive</b><small>{drive?'Uses the connected community account.':'Connect Drive first, or the file stays in this browser only.'}</small></span></label>
        <label className="campaign-check"><input type="checkbox" checked={form.sensitive} onChange={e=>setForm({...form,sensitive:e.target.checked})}/><span><b>Restricted document</b><small>Visible to admins and the board only — never shown on public case pages.</small></span></label>
      </div>
      <div className="doc-warning"><AlertTriangle size={14}/><span>Upload only what the decision needs. Do not store medical records, full identity documents, or bank statements unless a documented policy requires them.</span></div>
      <div className="campaign-form-actions"><button type="button" className="cancel-button" onClick={()=>{setShowForm(false);setPending([])}}>Cancel</button><button type="submit" className="primary-button"><CloudUpload size={15}/>Attach to case</button></div>
    </form>}

    <div className="doc-stats">
      <article><span>DOCUMENTS ON FILE</span><b>{documents.length.toString().padStart(2,'0')}</b><small><FileText size={12}/>Across all cases</small></article>
      <article><span>SAVED TO DRIVE</span><b>{savedCount.toString().padStart(2,'0')}</b><small><CheckCircle2 size={12}/>Drive file ID recorded</small></article>
      <article><span>AWAITING DRIVE</span><b>{pendingCount.toString().padStart(2,'0')}</b><small><Clock3 size={12}/>Not yet uploaded</small></article>
      <article><span>RESTRICTED</span><b>{documents.filter(d=>d.sensitive).length.toString().padStart(2,'0')}</b><small><ShieldCheck size={12}/>Admin & board only</small></article>
    </div>

    <div className="doc-toolbar"><div className="case-tabs">{['All documents','saved','pending','local'].map(f=><button key={f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{f==='saved'?'In Drive':f==='pending'?'Awaiting Drive':f==='local'?'Browser only':'All documents'}</button>)}</div>
      <label className="inline-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search documents or cases"/></label></div>

    <div className="doc-table panel">
      <div className="doc-table-head"><span>DOCUMENT</span><span>CASE</span><span>TYPE</span><span>ADDED</span><span>DRIVE</span><span/></div>
      {visible.map(doc=><div className="doc-row" key={doc.id}>
        <div className="doc-ident"><span className={`doc-kind ${doc.kind}`}><FileText size={15}/></span><div><b>{doc.name}</b><small>{doc.id} · {prettySize(doc.size)} · {doc.owner}{doc.sensitive&&<em> · restricted</em>}</small>{doc.notes&&<p>{doc.notes}</p>}</div></div>
        <span className="doc-case">{doc.caseRef||'Unlinked'}</span>
        <span className="doc-type">{doc.type}</span>
        <span className="doc-date">{doc.added}</span>
        <span className={`doc-drive ${doc.drive}`}>{doc.drive==='saved'?<><Check size={11}/>In Drive</>:doc.drive==='pending'?<><Clock3 size={11}/>Pending</>:<><HardDrive size={11}/>Local</>}</span>
        <div className="doc-actions">
          {doc.drive!=='saved'&&<button className="doc-action" title="Save to Google Drive" onClick={()=>sendToDrive(doc.id)}><CloudUpload size={14}/></button>}
          {doc.drive==='saved'&&<button className="doc-action" title="Open in Drive" onClick={()=>notify(`${doc.name} · Drive file ${doc.driveId} opens in your community Drive.`)}><ExternalLink size={14}/></button>}
          <button className="doc-action" title="Download" onClick={()=>download(doc)}><Download size={14}/></button>
          <button className="doc-action danger" title="Remove" onClick={()=>remove(doc.id)}><Trash2 size={14}/></button>
        </div>
      </div>)}
      {!visible.length&&<div className="empty-panel"><Info size={17}/><p>No documents in this view yet.</p></div>}
      <div className="doc-foot"><Info size={13}/><span>Storage note: files under 512 KB are kept in this browser for the prototype; larger files and every Drive save need the connected account. Production should upload server-side with signed URLs and store only the Drive file ID.</span></div>
    </div>
  </div>;
}
function DriveIcon(){return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#1a9d5a" d="M8.2 2.5 1 15l3.6 6.3 7.2-12.5z"/><path fill="#e0a11b" d="M15.8 2.5H8.2L15.4 15h7.2z"/><path fill="#3f7bd8" d="M4.6 21.3h14.8l3.2-6.3H7.8z"/></svg>}
