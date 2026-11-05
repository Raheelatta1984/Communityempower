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
