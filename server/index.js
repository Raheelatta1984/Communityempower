import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
const databaseUrl = process.env.DATABASE_URL || process.env.MYCOMM_DATABASE_URL || process.env.MYCOMM_POSTGRES_PRISMA_URL || process.env.MYCOMM_POSTGRES_URL || process.env.MYCOMM_DATABASE_URL_UNPOOLED || process.env.MYCOMM_POSTGRES_URL_NON_POOLING;
const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
}) : null;
const port = Number(process.env.PORT || 3001);

function adminOnly(req, res, next) {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Admin API is not configured.' });
  if (req.get('authorization') !== `Bearer ${expected}`) return res.status(401).json({ error: 'Unauthorised.' });
  next();
}
function dbRequired(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'Neon is not connected. Configure DATABASE_URL.' });
  next();
}
app.get('/api/health', async (_req, res) => {
  if (!pool) return res.json({ status: 'ok', database: 'not_configured' });
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'degraded', database: 'unavailable' }); }
});

// Public dashboard data is intentionally masked and excludes contact information and reviewer identities.
app.get('/api/public/:communitySlug/dashboard', dbRequired, async (req, res) => {
  try {
    const community = await pool.query(`SELECT c.id,c.name,c.slug,c.state_region,c.city,c.suburb,co.code country_code,co.currency_code,co.currency_symbol,co.minor_unit
      FROM communities c JOIN countries co ON co.id=c.country_id WHERE c.slug=$1 AND c.enabled=true`, [req.params.communitySlug]);
    if (!community.rowCount) return res.status(404).json({ error: 'Community not found.' });
    const c = community.rows[0];
    const [programs, requests, ledger, collection] = await Promise.all([
      pool.query(`SELECT p.id,p.name,p.description,p.category,p.enabled,p.monthly_goal,
        (SELECT count(*)::int FROM support_requests r WHERE r.program_id=p.id AND r.status NOT IN ('closed','declined')) open_cases,
        (SELECT coalesce(sum(l.amount),0)::numeric(18,2) FROM ledger_transactions l WHERE l.program_id=p.id AND l.entry_type='disbursement') distributed
        FROM programs p WHERE p.community_id=$1 ORDER BY p.name`, [c.id]),
      pool.query(`SELECT r.id,r.case_number,r.request_title,r.request_body,r.amount,r.currency_code,r.public_area,r.status,r.submitted_at,
mask_person_name(m.display_name) masked_name,p.name program_name,
        coalesce((SELECT a.board_approved_amount FROM case_board_allocations a WHERE a.request_id=r.id),0)::numeric(18,2) approved_amount,
        coalesce((SELECT sum(dl.amount) FROM ledger_transactions dl WHERE dl.request_id=r.id AND dl.entry_type='disbursement'),0)::numeric(18,2) disbursed_amount,
        count(v.member_id) FILTER (WHERE v.vote='support')::int support_votes,
        count(v.member_id)::int total_votes
        FROM support_requests r JOIN members m ON m.id=r.requester_id JOIN programs p ON p.id=r.program_id
        LEFT JOIN case_votes v ON v.request_id=r.id
        WHERE r.community_id=$1 AND r.status NOT IN ('closed','declined')
        GROUP BY r.id,m.display_name,p.name ORDER BY r.submitted_at DESC LIMIT 50`, [c.id]),
      pool.query(`SELECT l.id,l.occurred_at,l.entry_type,l.amount,l.currency_code,l.description,l.voucher_title,l.voucher_number,
        p.name program_name,co.code country_code,l.public_metadata
        FROM ledger_transactions l LEFT JOIN programs p ON p.id=l.program_id
        WHERE l.community_id=$1 ORDER BY l.occurred_at DESC LIMIT 100`, [c.id]),
      pool.query(`SELECT id,title,period_start,period_end,goal_amount,collected_amount,disbursed_amount,currency_code,status,gofund_url
        FROM gofund_collections WHERE community_id=$1 ORDER BY period_start DESC LIMIT 1`, [c.id]),
    ]);
    const totals = await pool.query(`SELECT
      coalesce(sum(amount) FILTER(WHERE entry_type='collection'),0)::numeric(18,2) collected,
      coalesce(sum(amount) FILTER(WHERE entry_type='disbursement'),0)::numeric(18,2) distributed
      FROM ledger_transactions WHERE community_id=$1 AND occurred_at >= date_trunc('month',now())`, [c.id]);
    res.set('Cache-Control', 'no-store');
    res.json({ community:c, programs:programs.rows, cases:requests.rows, transactions:ledger.rows, collection:collection.rows[0]||null, totals:totals.rows[0] });
  } catch (error) { console.error('dashboard query failed', error.message); res.status(500).json({ error: 'Unable to load community data.' }); }
});

app.get('/api/public/:communitySlug/budgets', dbRequired, async (req,res) => {
  const from=req.query.from||`${new Date().getUTCFullYear()}-01-01`;
  const to=req.query.to||`${new Date().getUTCFullYear()}-12-31`;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({error:'Use ISO calendar dates for from and to.'});
  try {
    const community=await pool.query('SELECT id FROM communities WHERE slug=$1 AND enabled=true',[req.params.communitySlug]);
    if(!community.rowCount)return res.status(404).json({error:'Community not found.'});
    const communityId=community.rows[0].id;
    const [programs,cases]=await Promise.all([
      pool.query(`SELECT p.id,p.slug,p.name,p.enabled,p.monthly_goal,co.currency_code,
        coalesce(b.expected_amount,p.monthly_goal*12,0)::numeric(18,2) expected_amount,
        coalesce(b.board_approved_amount,0)::numeric(18,2) approved_amount,
        coalesce(d.disbursed,0)::numeric(18,2) disbursed_amount
        FROM programs p JOIN communities cm ON cm.id=p.community_id JOIN countries co ON co.id=cm.country_id
        LEFT JOIN LATERAL (SELECT sum(expected_amount) expected_amount,sum(board_approved_amount) board_approved_amount FROM program_budget_allocations x WHERE x.program_id=p.id AND x.period_start >= $2::date AND x.period_end <= $3::date AND x.approval_status<>'declined') b ON true
        LEFT JOIN LATERAL (SELECT sum(amount) disbursed FROM ledger_transactions l WHERE l.program_id=p.id AND l.entry_type='disbursement' AND l.occurred_at::date BETWEEN $2::date AND $3::date) d ON true
        WHERE p.community_id=$1 ORDER BY p.name`,[communityId,from,to]),
      pool.query(`SELECT r.id,r.case_number,r.request_title,r.amount requested_amount,r.currency_code,r.status,r.public_area,r.submitted_at,
        mask_person_name(m.display_name) masked_name,p.name program_name,coalesce(a.board_approved_amount,0)::numeric(18,2) approved_amount,
        coalesce(d.disbursed,0)::numeric(18,2) disbursed_amount,r.installment_number,r.recurrence_plan_id,
        rp.next_case_month,rp.installment_limit,rp.generated_count
        FROM support_requests r JOIN programs p ON p.id=r.program_id JOIN members m ON m.id=r.requester_id
        LEFT JOIN case_board_allocations a ON a.request_id=r.id
        LEFT JOIN LATERAL (SELECT sum(l.amount) disbursed FROM ledger_transactions l WHERE l.request_id=r.id AND l.entry_type='disbursement') d ON true
        LEFT JOIN case_recurrence_plans rp ON rp.id=r.recurrence_plan_id
        WHERE r.community_id=$1 AND r.submitted_at::date BETWEEN $2::date AND $3::date AND r.status<>'declined'
        ORDER BY r.submitted_at DESC`,[communityId,from,to])
    ]);
    res.set('Cache-Control','no-store');res.json({period:{from,to},programs:programs.rows,cases:cases.rows});
  }catch(error){console.error('budget query failed',error.message);res.status(500).json({error:'Unable to load budget transparency.'})}
});

app.get('/api/public/:communitySlug/calendar', dbRequired, async (req,res) => {
  try{
    const c=await pool.query('SELECT id FROM communities WHERE slug=$1 AND enabled=true',[req.params.communitySlug]);if(!c.rowCount)return res.status(404).json({error:'Community not found.'});
    const events=await pool.query(`SELECT id,event_type,title,description,starts_at,ends_at,visibility FROM community_calendar_events
      WHERE community_id=$1 AND visibility IN ('members','public') AND status='scheduled' AND event_type NOT IN ('follow_up','marketing') ORDER BY starts_at`,[c.rows[0].id]);
    res.set('Cache-Control','no-store');res.json({events:events.rows});
  }catch(error){console.error('public calendar read failed',error.message);res.status(500).json({error:'Unable to load community calendar.'})}
});


// ---------------------------------------------------------------- votes
// One member, one vote, one time. The unique index is the real guard: a second
// attempt gets 409 and the existing record is returned, never overwritten.
app.get('/api/public/cases/:caseRef/vote', dbRequired, async (req,res) => {
  const { memberId } = req.query;
  if(!memberId) return res.status(400).json({error:'memberId is required.'});
  try{
    const found = await pool.query(`SELECT v.vote, v.voted_at, v.vote_source
      FROM case_votes v JOIN support_requests r ON r.id=v.request_id
      WHERE (r.case_number=$1 OR r.id::text=$1) AND v.member_id=$2`, [req.params.caseRef, memberId]);
    if(!found.rowCount) return res.json({voted:false});
    res.set('Cache-Control','no-store');
    res.json({voted:true, vote:found.rows[0].vote, votedAt:found.rows[0].voted_at, source:found.rows[0].vote_source});
  }catch(error){console.error('vote read failed',error.message);res.status(500).json({error:'Unable to read the vote record.'})}
});

app.post('/api/public/cases/:caseRef/vote', dbRequired, async (req,res) => {
  const { memberId, vote='support', deviceFingerprint=null } = req.body||{};
  if(!memberId) return res.status(400).json({error:'memberId is required to vote.'});
  if(!['support','do_not_support','abstain'].includes(vote)) return res.status(400).json({error:'Unsupported vote value.'});
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const record = await client.query(`SELECT r.id,r.community_id,r.case_number,r.status FROM support_requests r
      WHERE r.case_number=$1 OR r.id::text=$1 FOR UPDATE`, [req.params.caseRef]);
    if(!record.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Case not found.'})}
    const request = record.rows[0];
    if(['closed','declined','distributed'].includes(request.status)){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Voting is closed for this case.',reason:'case_closed'});
    }
    const member = await client.query(`SELECT m.id FROM members m
      JOIN community_memberships cm ON cm.member_id=m.id
      WHERE m.id=$1 AND cm.community_id=$2 AND cm.status='active'
      AND m.onboarding_status='approved' LIMIT 1`, [memberId, request.community_id]);
    if(!member.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'Only active community members may vote.',reason:'not_a_member'})}

    const existing = await client.query('SELECT vote, voted_at FROM case_votes WHERE request_id=$1 AND member_id=$2', [request.id, memberId]);
    if(existing.rowCount){
      await client.query('COMMIT');
      return res.status(409).json({
        error:'This member has already voted on this case. Votes cannot be repeated or changed.',
        reason:'duplicate_vote',
        vote:existing.rows[0].vote,
        votedAt:existing.rows[0].voted_at
      });
    }
    const inserted = await client.query(`INSERT INTO case_votes(request_id,member_id,vote,voted_at,voter_community_id,vote_source,device_fingerprint)
      VALUES($1,$2,$3,now(),$4,'portal',$5) RETURNING vote,voted_at`,[request.id,memberId,vote,request.community_id,deviceFingerprint]);
    await client.query(`INSERT INTO audit_log(actor_id,community_id,action,entity_type,entity_id,metadata)
      VALUES($1,$2,'case_vote_recorded','support_request',$3,$4)`,[memberId,request.community_id,request.id,JSON.stringify({vote,caseNumber:request.case_number})]);
    await client.query('COMMIT');
    res.status(201).json({recorded:true, vote:inserted.rows[0].vote, votedAt:inserted.rows[0].voted_at, locked:true});
  }catch(error){
    await client.query('ROLLBACK');
    if(error.code==='23505') return res.status(409).json({error:'This member has already voted on this case.',reason:'duplicate_vote'});
    console.error('vote write failed',error.message);
    res.status(500).json({error:'Unable to record the vote.'});
  }finally{client.release()}
});

// ------------------------------------------------------------ campaigns
app.get('/api/public/:communitySlug/campaigns', dbRequired, async (req,res) => {
  try{
    const c=await pool.query('SELECT id FROM communities WHERE slug=$1 AND enabled=true',[req.params.communitySlug]);
    if(!c.rowCount)return res.status(404).json({error:'Community not found.'});
    const rows=await pool.query(`SELECT cp.id,cp.campaign_number,cp.title,cp.public_story,cp.currency_code,cp.target_amount,cp.raised_amount,
        cp.disbursed_amount,cp.status,cp.window_end,cp.percent_funded,r.case_number,p.name program_name
      FROM public_campaign_progress cp
      LEFT JOIN support_requests r ON r.id=cp.request_id
      LEFT JOIN programs p ON p.id=cp.program_id
      WHERE cp.community_id=$1 ORDER BY cp.status, cp.window_end`,[c.rows[0].id]);
    res.set('Cache-Control','no-store');res.json({campaigns:rows.rows});
  }catch(error){console.error('campaign read failed',error.message);res.status(500).json({error:'Unable to load campaigns.'})}
});

app.post('/api/admin/communities/:communitySlug/campaigns', adminOnly, dbRequired, async (req,res) => {
  const {memberId,title,publicStory='',targetAmount,caseRef,programId,durationDays=30,monthlyPoolContribution=0,externalCampaignUrl=null}=req.body||{};
  if(!memberId||!title?.trim()||!Number.isFinite(Number(targetAmount))||Number(targetAmount)<=0)return res.status(400).json({error:'memberId, title, and a positive targetAmount are required.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const c=await client.query('SELECT cm.id,co.currency_code FROM communities cm JOIN countries co ON co.id=cm.country_id WHERE cm.slug=$1',[req.params.communitySlug]);
    if(!c.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Community not found.'})}
    const community=c.rows[0];
    if(!await assertCommunityAdmin(client,community.id,memberId)){await client.query('ROLLBACK');return res.status(403).json({error:'Active community admin membership required.'})}
    let requestId=null;
    if(caseRef){const found=await client.query('SELECT id FROM support_requests WHERE (case_number=$1 OR id::text=$1) AND community_id=$2',[caseRef,community.id]);requestId=found.rows[0]?.id||null}
    const number=`CMP-${new Date().getFullYear()}${String(Date.now()).slice(-4)}`;
    const created=await client.query(`INSERT INTO fundraising_campaigns(community_id,request_id,program_id,campaign_number,title,public_story,currency_code,target_amount,monthly_pool_contribution,external_campaign_url,window_end,status,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,current_date + ($11::int),'awaiting_board',$12)
      RETURNING id,campaign_number,title,target_amount,status,window_end`,
      [community.id,requestId,programId||null,number,title.trim(),publicStory,community.currency_code,Number(targetAmount),Number(monthlyPoolContribution)||0,externalCampaignUrl,Number(durationDays)||30,memberId]);
    await client.query(`INSERT INTO audit_log(actor_id,community_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'campaign_created','fundraising_campaign',$3,$4)`,
      [memberId,community.id,created.rows[0].id,JSON.stringify({targetAmount:Number(targetAmount),caseRef:caseRef||null})]);
    await client.query('COMMIT');
    // Drafts must never be published automatically; the board decides.
    res.status(201).json({campaign:created.rows[0],note:'Campaign created as awaiting_board. A board decision is required before donors can contribute.'});
  }catch(error){await client.query('ROLLBACK');console.error('campaign create failed',error.message);res.status(400).json({error:'Unable to create the campaign.'})}
  finally{client.release()}
});

// ------------------------------------------------------------ documents
app.get('/api/admin/cases/:caseRef/documents', adminOnly, dbRequired, async (req,res) => {
  const {memberId}=req.query;
  if(!memberId)return res.status(400).json({error:'memberId is required.'});
  try{
    const record=await pool.query('SELECT id,community_id FROM support_requests WHERE case_number=$1 OR id::text=$1',[req.params.caseRef]);
    if(!record.rowCount)return res.status(404).json({error:'Case not found.'});
    if(!await assertCommunityAdmin(pool,record.rows[0].community_id,memberId))return res.status(403).json({error:'Active community admin membership required.'});
    const docs=await pool.query(`SELECT id,file_name,mime_type,byte_size,document_type,visibility,storage_provider,drive_file_id,sync_status,created_at
      FROM case_documents WHERE request_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`,[record.rows[0].id]);
    res.set('Cache-Control','no-store');res.json({documents:docs.rows});
  }catch(error){console.error('document read failed',error.message);res.status(500).json({error:'Unable to load case documents.'})}
});

// Metadata is registered here; the binary is uploaded by an approved storage adapter
// (Google Drive with drive.file scope) which then PATCHes the drive file id.
app.post('/api/admin/cases/:caseRef/documents', adminOnly, dbRequired, async (req,res) => {
  const {memberId,fileName,mimeType,byteSize,documentType='other',visibility='admins',reviewerNote='',storageProvider='google_drive',driveFolderPath=null}=req.body||{};
  if(!memberId||!fileName?.trim())return res.status(400).json({error:'memberId and fileName are required.'});
  if(!['case_evidence','identity','quote_invoice','voucher','board_pack','campaign_material','other'].includes(documentType))return res.status(400).json({error:'Unsupported documentType.'});
  if(!['admins','board','public'].includes(visibility))return res.status(400).json({error:'Unsupported visibility.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const record=await client.query('SELECT id,community_id FROM support_requests WHERE case_number=$1 OR id::text=$1',[req.params.caseRef]);
    if(!record.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Case not found.'})}
    const {id:requestId,community_id:communityId}=record.rows[0];
    if(!await assertCommunityAdmin(client,communityId,memberId)){await client.query('ROLLBACK');return res.status(403).json({error:'Active community admin membership required.'})}
    const drive=await client.query('SELECT google_drive_account,google_drive_folder FROM community_master_settings WHERE community_id=$1',[communityId]);
    const hasDrive=!!drive.rows[0]?.google_drive_account;
    const created=await client.query(`INSERT INTO case_documents(community_id,request_id,uploaded_by,file_name,mime_type,byte_size,document_type,visibility,reviewer_note,storage_provider,drive_folder_path,sync_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,file_name,sync_status,storage_provider`,
      [communityId,requestId,memberId,fileName.trim(),mimeType||null,Number(byteSize)||null,documentType,visibility,reviewerNote||null,
       hasDrive?storageProvider:'browser',driveFolderPath||drive.rows[0]?.google_drive_folder||null,hasDrive?'pending':'local_only']);
    await client.query(`INSERT INTO audit_log(actor_id,community_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'case_document_attached','case_document',$3,$4)`,
      [memberId,communityId,created.rows[0].id,JSON.stringify({requestId,documentType,visibility,hasDrive})]);
    await client.query('COMMIT');
    res.status(201).json({document:created.rows[0],driveConnected:hasDrive});
  }catch(error){await client.query('ROLLBACK');console.error('document write failed',error.message);res.status(400).json({error:'Unable to attach the document.'})}
  finally{client.release()}
});

// ------------------------------------------------------------- ballpark
app.get('/api/admin/communities/:communitySlug/ballpark', adminOnly, dbRequired, async (req,res) => {
  const {memberId}=req.query;
  if(!memberId)return res.status(400).json({error:'memberId is required.'});
  try{
    const c=await pool.query('SELECT id FROM communities WHERE slug=$1',[req.params.communitySlug]);
    if(!c.rowCount)return res.status(404).json({error:'Community not found.'});
    if(!await assertCommunityAdmin(pool,c.rows[0].id,memberId))return res.status(403).json({error:'Active community admin membership required.'});
    const rows=await pool.query(`SELECT b.id,p.name program_name,b.period_start,b.period_end,b.currency_code,b.available_funds,
      b.reserve_percent,b.ballpark_percent,b.ballpark_amount,b.quick_action_amount,
      coalesce((SELECT sum(l.amount) FROM ledger_transactions l WHERE l.program_id=p.id AND l.entry_type='disbursement' AND l.occurred_at::date BETWEEN b.period_start AND b.period_end),0)::numeric(18,2) dispatched_in_period
      FROM program_ballpark_allocations b JOIN programs p ON p.id=b.program_id
      WHERE b.community_id=$1 ORDER BY p.name`,[c.rows[0].id]);
    res.set('Cache-Control','no-store');
    res.json({planning_only:true,note:'Ballpark figures are planning estimates. They never authorise a disbursement.',allocations:rows.rows});
  }catch(error){console.error('ballpark read failed',error.message);res.status(500).json({error:'Unable to load ballpark allocations.'})}
});

app.post('/api/admin/communities/:communitySlug/ballpark', adminOnly, dbRequired, async (req,res) => {
  const {memberId,periodStart,periodEnd,availableFunds,reservePercent=15,quickActionAmount=0,allocations=[]}=req.body||{};
  const iso=/^\d{4}-\d{2}-\d{2}$/;
  if(!memberId||!iso.test(periodStart||'')||!iso.test(periodEnd||'')||periodStart>periodEnd)return res.status(400).json({error:'memberId and a valid period are required.'});
  if(!Array.isArray(allocations)||!allocations.length)return res.status(400).json({error:'Provide at least one program allocation.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const c=await client.query('SELECT id FROM communities WHERE slug=$1',[req.params.communitySlug]);
    if(!c.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Community not found.'})}
    const communityId=c.rows[0].id;
    if(!await assertCommunityAdmin(client,communityId,memberId)){await client.query('ROLLBACK');return res.status(403).json({error:'Active community admin membership required.'})}
    for(const row of allocations){
      if(!row.programId||!Number.isFinite(Number(row.ballparkPercent)))continue;
      await client.query(`INSERT INTO program_ballpark_allocations(community_id,program_id,period_start,period_end,currency_code,available_funds,reserve_percent,ballpark_percent,quick_action_amount,created_by)
        SELECT $1,$2,$3,$4,co.currency_code,$5,$6,$7,$8,$9 FROM communities cm JOIN countries co ON co.id=cm.country_id WHERE cm.id=$1
        ON CONFLICT(program_id,period_start,period_end) DO UPDATE SET available_funds=EXCLUDED.available_funds,reserve_percent=EXCLUDED.reserve_percent,ballpark_percent=EXCLUDED.ballpark_percent,quick_action_amount=EXCLUDED.quick_action_amount,updated_at=now()`,
        [communityId,row.programId,periodStart,periodEnd,Number(availableFunds)||0,Number(reservePercent)||0,Number(row.ballparkPercent)||0,Number(quickActionAmount)||0,memberId]);
    }
    await client.query(`INSERT INTO audit_log(actor_id,community_id,action,entity_type,metadata) VALUES($1,$2,'ballpark_plan_saved','community',$3)`,
      [memberId,communityId,JSON.stringify({periodStart,periodEnd,availableFunds:Number(availableFunds)||0,programs:allocations.length})]);
    await client.query('COMMIT');
    res.json({saved:true,planning_only:true});
  }catch(error){await client.query('ROLLBACK');console.error('ballpark write failed',error.message);res.status(400).json({error:'Unable to save the ballpark plan.'})}
  finally{client.release()}
});

// ---------------------------------------------------------- communities
app.get('/api/public/communities', dbRequired, async (_req,res) => {
  try{
    const rows=await pool.query(`SELECT c.slug,c.name,c.short_code,c.state_region,c.city,co.code country_code,co.currency_code
      FROM communities c JOIN countries co ON co.id=c.country_id WHERE c.enabled=true ORDER BY c.name`);
    res.set('Cache-Control','no-store');res.json({communities:rows.rows});
  }catch(error){console.error('community list failed',error.message);res.status(500).json({error:'Unable to load communities.'})}
});

// ------------------------------------------------------------- language
app.get('/api/public/languages', dbRequired, async (_req,res) => {
  try{
    const rows=await pool.query('SELECT code,label,direction,interface_supported,enabled FROM portal_languages ORDER BY enabled DESC,label');
    res.set('Cache-Control','public, max-age=3600');res.json({languages:rows.rows});
  }catch(error){console.error('language list failed',error.message);res.status(500).json({error:'Unable to load languages.'})}
});

// ---------------------------------------------------------- case studies
app.get('/api/public/:communitySlug/case-studies', dbRequired, async (req,res) => {
  try{
    const c=await pool.query('SELECT id FROM communities WHERE slug=$1 AND enabled=true',[req.params.communitySlug]);
    if(!c.rowCount)return res.status(404).json({error:'Community not found.'});
    const rows=await pool.query(`SELECT study_number,title,scale,public_summary,situation,approach,verification,board_presentation,board_decision,fundraising,distribution,lessons,
      requested_amount,collected_amount,distributed_amount
      FROM case_studies WHERE community_id=$1 AND published=true ORDER BY created_at DESC`,[c.rows[0].id]);
    res.set('Cache-Control','no-store');res.json({caseStudies:rows.rows});
  }catch(error){console.error('case study read failed',error.message);res.status(500).json({error:'Unable to load case studies.'})}
});

// Admin calendar and case-monitoring tools require both the trusted API token and an active admin membership.
async function assertCommunityAdmin(client, communityId, memberId) {
  const access=await client.query(`SELECT 1 FROM community_memberships WHERE community_id=$1 AND member_id=$2 AND role='admin' AND status='active'`,[communityId,memberId]);
  return access.rowCount>0;
}
app.post('/api/admin/communities/:communitySlug/statements', adminOnly, dbRequired, async (req,res) => {
  const {memberId,periodStart,periodEnd,cadence='monthly',currencyCode='AUD',collectionTotal=0,disbursementTotal=0,entryCount=0,format='pdf',statementRequestId,metadata={}}=req.body||{};
  const iso=/^\d{4}-\d{2}-\d{2}$/;
  if(!memberId||!iso.test(periodStart||'')||!iso.test(periodEnd||'')||periodStart>periodEnd||!['daily','weekly','monthly','quarterly','yearly'].includes(cadence)||!['pdf','csv'].includes(format))return res.status(400).json({error:'Provide an admin member, valid period, cadence, and format.'});
  if(!Number.isFinite(Number(collectionTotal))||!Number.isFinite(Number(disbursementTotal))||!Number.isInteger(Number(entryCount)))return res.status(400).json({error:'Statement totals and entry count must be numeric.'});
  try{
    const c=await pool.query('SELECT id FROM communities WHERE slug=$1',[req.params.communitySlug]);if(!c.rowCount)return res.status(404).json({error:'Community not found.'});
    if(!await assertCommunityAdmin(pool,c.rows[0].id,memberId))return res.status(403).json({error:'Active community admin membership required.'});
    const run=await pool.query(`INSERT INTO financial_statement_runs(statement_request_id,community_id,period_start,period_end,cadence,currency_code,collection_total,disbursement_total,entry_count,format,generated_by,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,status,generated_at`,[statementRequestId||null,c.rows[0].id,periodStart,periodEnd,cadence,currencyCode,collectionTotal,disbursementTotal,entryCount,format,memberId,JSON.stringify(metadata)]);
    res.status(201).json({statement:run.rows[0]});
  }catch(error){console.error('statement record failed',error.message);res.status(400).json({error:'Unable to record statement generation.'})}
});

app.get('/api/admin/communities/:communitySlug/calendar', adminOnly, dbRequired, async (req,res) => {
  const {memberId,from,to}=req.query;
  if(!memberId)return res.status(400).json({error:'memberId is required for admin authorization.'});
  try{
    const c=await pool.query('SELECT id FROM communities WHERE slug=$1',[req.params.communitySlug]);
    if(!c.rowCount)return res.status(404).json({error:'Community not found.'});
    if(!await assertCommunityAdmin(pool,c.rows[0].id,memberId))return res.status(403).json({error:'Active community admin membership required.'});
    const result=await pool.query(`SELECT id,event_type,title,description,starts_at,ends_at,visibility,owner_id,case_id,program_id,reminder_at,reminder_status,status
      FROM community_calendar_events WHERE community_id=$1 AND ($2::date IS NULL OR starts_at >= $2::date) AND ($3::date IS NULL OR starts_at < ($3::date+1)) ORDER BY starts_at`,[c.rows[0].id,from||null,to||null]);
    res.set('Cache-Control','no-store');res.json({events:result.rows});
  }catch(error){console.error('calendar read failed',error.message);res.status(500).json({error:'Unable to load calendar.'})}
});
app.post('/api/admin/communities/:communitySlug/calendar', adminOnly, dbRequired, async (req,res) => {
  const {memberId,title,description='',eventType,startsAt,endsAt,visibility='admins',ownerId,caseId,programId,reminderAt}=req.body||{};
  const allowed=['commitment','due_date','follow_up','disbursement_reminder','marketing','meeting','community_event'];
  if(!memberId||!title||!startsAt||!allowed.includes(eventType))return res.status(400).json({error:'memberId, title, startsAt, and a valid eventType are required.'});
  const safeVisibility=['follow_up','marketing','disbursement_reminder'].includes(eventType)?'admins':visibility;
  if(!['admins','members','public'].includes(safeVisibility))return res.status(400).json({error:'Unsupported calendar visibility.'});
  try{
    const c=await pool.query('SELECT id FROM communities WHERE slug=$1',[req.params.communitySlug]);
    if(!c.rowCount)return res.status(404).json({error:'Community not found.'});
    if(!await assertCommunityAdmin(pool,c.rows[0].id,memberId))return res.status(403).json({error:'Active community admin membership required.'});
    const result=await pool.query(`INSERT INTO community_calendar_events(community_id,event_type,title,description,starts_at,ends_at,visibility,owner_id,case_id,program_id,reminder_at,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id,event_type,title,starts_at,visibility,status`,[c.rows[0].id,eventType,title,description,startsAt,endsAt||null,safeVisibility,ownerId||null,caseId||null,programId||null,reminderAt||null,memberId]);
    await pool.query(`INSERT INTO audit_log(actor_id,community_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'calendar_event_created','calendar_event',$3,$4)`,[memberId,c.rows[0].id,result.rows[0].id,JSON.stringify({eventType,visibility:safeVisibility})]);
    res.status(201).json({event:result.rows[0]});
  }catch(error){console.error('calendar create failed',error.message);res.status(400).json({error:'Unable to create calendar event.'})}
});
app.get('/api/admin/communities/:communitySlug/close-monitoring', adminOnly, dbRequired, async (req,res) => {
  const {memberId}=req.query;if(!memberId)return res.status(400).json({error:'memberId is required for admin authorization.'});
  try{
    const c=await pool.query('SELECT id FROM communities WHERE slug=$1',[req.params.communitySlug]);if(!c.rowCount)return res.status(404).json({error:'Community not found.'});
    if(!await assertCommunityAdmin(pool,c.rows[0].id,memberId))return res.status(403).json({error:'Active community admin membership required.'});
    const cases=await pool.query(`SELECT r.id,r.case_number,r.request_title,r.amount,r.currency_code,r.status,r.submitted_at,
      mask_person_name(m.display_name) masked_name,p.name program_name,
      EXISTS(SELECT 1 FROM member_case_flags f WHERE f.member_id=m.id AND f.community_id=r.community_id AND f.active=true AND f.flag_type='repeat_request') repeat_request_flag
      FROM support_requests r JOIN members m ON m.id=r.requester_id JOIN programs p ON p.id=r.program_id
      WHERE r.community_id=$1 AND r.status NOT IN ('closed','declined') AND r.exclude_from_close_monitoring=false
      ORDER BY r.submitted_at`,[c.rows[0].id]);
    res.set('Cache-Control','no-store');res.json({cases:cases.rows});
  }catch(error){console.error('close monitoring query failed',error.message);res.status(500).json({error:'Unable to load close-monitoring cases.'})}
});
app.post('/api/admin/cases/:caseId/repeat-flag', adminOnly, dbRequired, async (req,res) => {
  const {memberId,reason,flagType='repeat_request'}=req.body||{};
  if(!memberId||!reason?.trim()||!['repeat_request','recurring_assistance','extra_follow_up'].includes(flagType))return res.status(400).json({error:'memberId, reason, and a valid flagType are required.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const c=await client.query(`SELECT r.id,r.community_id,r.requester_id FROM support_requests r WHERE r.id=$1 OR r.case_number=$1`,[req.params.caseId]);
    if(!c.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Case not found.'})}
    const record=c.rows[0];if(!await assertCommunityAdmin(client,record.community_id,memberId)){await client.query('ROLLBACK');return res.status(403).json({error:'Active community admin membership required.'})}
    const flag=await client.query(`INSERT INTO member_case_flags(member_id,community_id,flag_type,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at,active`,[record.requester_id,record.community_id,flagType,reason.trim(),memberId]);
    await client.query(`UPDATE members SET repeat_case_flag=true,repeat_case_flagged_by=$2,repeat_case_flagged_at=now(),repeat_case_private_note=$3 WHERE id=$1`,[record.requester_id,memberId,reason.trim()]);
    await client.query(`INSERT INTO audit_log(actor_id,community_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'repeat_case_flagged','support_request',$3,$4)`,[memberId,record.community_id,record.id,JSON.stringify({flagId:flag.rows[0].id,flagType})]);
    await client.query('COMMIT');res.status(201).json({flag:flag.rows[0]});
  }catch(error){await client.query('ROLLBACK');console.error('repeat flag failed',error.message);res.status(400).json({error:'Unable to record repeat-case follow-up.'})}finally{client.release()}
});

app.post('/api/admin/cases/:caseId/repeat-flag/clear', adminOnly, dbRequired, async (req,res) => {
  const {memberId}=req.body||{};if(!memberId)return res.status(400).json({error:'memberId is required.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const c=await client.query(`SELECT r.id,r.community_id,r.requester_id FROM support_requests r WHERE r.id=$1 OR r.case_number=$1`,[req.params.caseId]);
    if(!c.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Case not found.'})}
    const record=c.rows[0];if(!await assertCommunityAdmin(client,record.community_id,memberId)){await client.query('ROLLBACK');return res.status(403).json({error:'Active community admin membership required.'})}
    await client.query(`UPDATE member_case_flags SET active=false,cleared_at=now(),reviewed_by=$2,reviewed_at=now() WHERE member_id=$1 AND community_id=$3 AND flag_type='repeat_request' AND active=true`,[record.requester_id,memberId,record.community_id]);
    const remaining=await client.query(`SELECT EXISTS(SELECT 1 FROM member_case_flags WHERE member_id=$1 AND active=true AND flag_type='repeat_request') active`,[record.requester_id]);
    if(!remaining.rows[0].active)await client.query(`UPDATE members SET repeat_case_flag=false,repeat_case_flagged_by=NULL,repeat_case_flagged_at=NULL,repeat_case_private_note=NULL WHERE id=$1`,[record.requester_id]);
    await client.query(`INSERT INTO audit_log(actor_id,community_id,action,entity_type,entity_id) VALUES($1,$2,'repeat_case_flag_cleared','support_request',$3)`,[memberId,record.community_id,record.id]);
    await client.query('COMMIT');res.json({cleared:true});
  }catch(error){await client.query('ROLLBACK');console.error('repeat flag clear failed',error.message);res.status(400).json({error:'Unable to clear repeat-case flag.'})}finally{client.release()}
});

// Protected integration endpoints are for trusted job runners and financial reconciliation only.
app.post('/api/admin/collections/:id/disbursement', adminOnly, dbRequired, async (req, res) => {
  const { amount, description, voucherTitle, voucherNumber, occurredAt } = req.body || {};
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || !description || !voucherTitle || !voucherNumber) return res.status(400).json({ error: 'amount, description, voucherTitle, and voucherNumber are required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query('SELECT * FROM gofund_collections WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!c.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Collection not found.' }); }
    const record = c.rows[0];
    const tx = await client.query(`INSERT INTO ledger_transactions(community_id,collection_id,country_id,entry_type,amount,currency_code,description,voucher_title,voucher_number,occurred_at)
      VALUES($1,$2,$3,'disbursement',$4,$5,$6,$7,$8,coalesce($9::timestamptz,now())) RETURNING id`,
      [record.community_id, record.id, record.country_id, amount, record.currency_code, description, voucherTitle, voucherNumber, occurredAt||null]);
    await client.query(`UPDATE gofund_collections SET disbursed_amount=disbursed_amount+$2,status='disbursed',updated_at=now() WHERE id=$1`, [record.id, amount]);
    await client.query('COMMIT');
    res.status(201).json({ id:tx.rows[0].id, voucherNumber, status:'recorded' });
  } catch (error) { await client.query('ROLLBACK'); console.error('disbursement failed',error.message); res.status(400).json({ error:'Unable to record disbursement; check voucher uniqueness and collection data.' }); }
  finally { client.release(); }
});

app.post('/api/admin/statements/run', adminOnly, dbRequired, async (req,res) => {
  const { cadence='daily' } = req.body || {};
  if (!['daily','weekly','monthly','quarterly','yearly'].includes(cadence)) return res.status(400).json({error:'Unsupported statement cadence.'});
  try {
    const result = await pool.query(`UPDATE statement_requests SET status='generating'
      WHERE id IN (SELECT id FROM statement_requests WHERE status='queued' AND cadence=$1 ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 100)
      RETURNING id,community_id,requested_by`,[cadence]);
    res.json({ cadence, claimed:result.rowCount, requests:result.rows.map(({id})=>({id})) });
  } catch (error) { console.error('statement job failed',error.message); res.status(500).json({error:'Unable to process statement batch.'}); }
});

// In local development Vite proxies /api here. Production deployment should serve the built static app separately.
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(root));
  app.get('*', (_req,res)=>res.sendFile(path.join(root,'index.html')));
}
if (!process.env.VERCEL) app.listen(port,'0.0.0.0',()=>console.log(`Kindred API listening on 0.0.0.0:${port}; Neon ${pool?'configured':'not configured'}`));
export default app;
