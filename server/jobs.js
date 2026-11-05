import pg from 'pg';
const { Pool } = pg;
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL before running scheduled jobs.'); process.exit(1); }
const pool = new Pool({ connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:false}, max:2 });
const job = process.argv[2];
try {
  if (job === 'collections') {
    // Run on the final day of each month. Create next month's centrally managed community campaign once.
    const result = await pool.query(`INSERT INTO gofund_collections(community_id,country_id,period_start,period_end,title,currency_code,goal_amount,status)
      SELECT c.id,c.country_id,date_trunc('month',current_date + interval '1 month')::date,
        (date_trunc('month',current_date + interval '2 month')::date - 1),
        to_char(current_date + interval '1 month','FMMonth YYYY') || ' community fund',co.currency_code,
        coalesce((SELECT sum(p.monthly_goal) FROM programs p WHERE p.community_id=c.id AND p.enabled),0),'scheduled'
      FROM communities c JOIN countries co ON co.id=c.country_id
      WHERE c.enabled=true
      ON CONFLICT(community_id,period_start) DO NOTHING RETURNING id,community_id,title,period_start`);
    console.log(JSON.stringify({job:'collections',created:result.rowCount,collections:result.rows}));
  } else if (job === 'notify-statements') {
    // The report renderer should set status=ready and generated_at after the artifact is stored.
    // This task only queues notification records for completed statements and is safe to re-run.
    const result = await pool.query(`WITH pending AS (
      SELECT s.id,s.requested_by,s.cadence,s.period_start,s.period_end FROM statement_requests s
      WHERE s.status='ready' AND s.notified_at IS NULL FOR UPDATE SKIP LOCKED LIMIT 200
    ), inserted AS (
      INSERT INTO notifications(member_id,kind,title,body)
      SELECT p.requested_by,'statement_ready','Your statement is ready',
        initcap(p.cadence) || ' statement for ' || p.period_start || ' to ' || p.period_end || ' is ready.' FROM pending p
      RETURNING member_id
    ) UPDATE statement_requests s SET notified_at=now() FROM pending p WHERE s.id=p.id RETURNING s.id`);
    console.log(JSON.stringify({job:'notify-statements',notified:result.rowCount}));
  } else {
    console.error('Usage: node server/jobs.js collections|notify-statements'); process.exitCode=2;
  }
} catch (error) {
  console.error(`Scheduled job ${job} failed:`,error.message);
  process.exitCode=1;
} finally { await pool.end(); }
