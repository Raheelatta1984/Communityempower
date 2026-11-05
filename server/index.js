import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
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
        m.display_name masked_name,p.name program_name,
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
        m.display_name masked_name,p.name program_name,coalesce(a.board_approved_amount,0)::numeric(18,2) approved_amount,
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
if (process.env.NODE_ENV === 'production') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(root));
  app.get('*', (_req,res)=>res.sendFile(path.join(root,'index.html')));
}
app.listen(port,'0.0.0.0',()=>console.log(`Kindred API listening on 0.0.0.0:${port}`));
