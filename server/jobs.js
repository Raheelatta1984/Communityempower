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
  } else if (job === 'recurring-cases') {
    // Run monthly. Each due installment gets a NEW submitted case number and re-enters the full review workflow.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const due = await client.query(`SELECT rp.*,sr.country_id,sr.public_area
        FROM case_recurrence_plans rp JOIN support_requests sr ON sr.id=rp.source_request_id
        WHERE rp.enabled=true AND rp.next_case_month<=current_date
          AND (rp.installment_limit IS NULL OR rp.generated_count<rp.installment_limit)
        ORDER BY rp.next_case_month FOR UPDATE OF rp SKIP LOCKED LIMIT 200`);
      const created=[];
      for (const plan of due.rows) {
        const installment=plan.generated_count+1;
        const caseNumber=`RC-${new Date(plan.next_case_month).toISOString().slice(0,10).replaceAll('-','')}-${plan.id.slice(0,8).toUpperCase()}-${installment}`;
        const inserted=await client.query(`INSERT INTO support_requests(case_number,community_id,program_id,requester_id,country_id,request_title,request_body,amount,currency_code,public_area,status,recurrence_plan_id,installment_number)
          VALUES($1,$2,$3,$4,$5,$6 || ' — ' || to_char($7::date,'FMMonth YYYY'),$8,$9,$10,$11,'submitted',$12,$13)
          ON CONFLICT(case_number) DO NOTHING RETURNING id,case_number`,[
          caseNumber,plan.community_id,plan.program_id,plan.requester_id,plan.country_id,plan.title_template,plan.next_case_month,
          plan.description_template,plan.installment_amount,plan.currency_code,plan.public_area,plan.id,installment
        ]);
        if (inserted.rowCount) created.push(inserted.rows[0]);
        await client.query(`UPDATE case_recurrence_plans SET generated_count=generated_count+1,next_case_month=(next_case_month + interval '1 month')::date,
          enabled=CASE WHEN installment_limit IS NOT NULL AND generated_count+1>=installment_limit THEN false ELSE enabled END WHERE id=$1`,[plan.id]);
      }
      await client.query('COMMIT');
      console.log(JSON.stringify({job:'recurring-cases',created:created.length,cases:created}));
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
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
