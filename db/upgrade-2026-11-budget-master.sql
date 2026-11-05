-- Budget comparison, recurring monthly cases, and configurable community master.
-- Apply after db/schema.sql with: psql "$DATABASE_URL" -f db/upgrade-2026-11-budget-master.sql
CREATE TABLE IF NOT EXISTS community_master_settings (
  community_id uuid PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,
  application_name text NOT NULL DEFAULT 'Kindred', logo_url text,
  theme_key text NOT NULL DEFAULT 'forest' CHECK(theme_key IN ('forest','ocean','clay','violet')),
  facebook_group_url text, whatsapp_group_url text,
  default_language text NOT NULL DEFAULT 'en', enabled_languages text[] NOT NULL DEFAULT ARRAY['en'],
  default_statement_cadence text NOT NULL DEFAULT 'daily' CHECK(default_statement_cadence IN ('daily','weekly','monthly','quarterly','yearly')),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS program_budget_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  period_start date NOT NULL, period_end date NOT NULL,
  currency_code char(3) NOT NULL,
  expected_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK(expected_amount >= 0),
  board_approved_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK(board_approved_amount >= 0),
  approval_status text NOT NULL DEFAULT 'draft' CHECK(approval_status IN ('draft','submitted','approved','declined','revised')),
  approved_by uuid REFERENCES members(id), approved_at timestamptz, board_note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(program_id,period_start,period_end)
);
CREATE INDEX IF NOT EXISTS idx_program_budget_period ON program_budget_allocations(community_id,period_start,period_end);

CREATE TABLE IF NOT EXISTS case_board_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE UNIQUE,
  currency_code char(3) NOT NULL, requested_amount numeric(18,4) NOT NULL CHECK(requested_amount >= 0),
  board_approved_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK(board_approved_amount >= 0),
  approval_status text NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','declined','revised')),
  approved_by uuid REFERENCES members(id), approved_at timestamptz, board_note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_recurrence_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  source_request_id uuid NOT NULL REFERENCES support_requests(id), requester_id uuid NOT NULL REFERENCES members(id),
  program_id uuid NOT NULL REFERENCES programs(id), title_template text NOT NULL, description_template text NOT NULL,
  installment_amount numeric(18,4) NOT NULL CHECK(installment_amount > 0), currency_code char(3) NOT NULL,
  cadence text NOT NULL DEFAULT 'monthly' CHECK(cadence='monthly'), start_month date NOT NULL,
  end_month date, next_case_month date NOT NULL, installment_limit smallint CHECK(installment_limit IS NULL OR installment_limit > 0),
  generated_count smallint NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES members(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS recurrence_plan_id uuid REFERENCES case_recurrence_plans(id);
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS installment_number smallint;
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurrence_case_number ON support_requests(recurrence_plan_id,installment_number) WHERE recurrence_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recurrence_due ON case_recurrence_plans(next_case_month) WHERE enabled=true;

-- Disbursement totals are derived from ledger_transactions, so all amounts stay traceable to voucher records.
CREATE OR REPLACE VIEW public_program_budget_transparency AS
SELECT b.id,b.community_id,b.program_id,p.name program_name,b.period_start,b.period_end,b.currency_code,
       b.expected_amount,b.board_approved_amount,b.approval_status,
       coalesce(sum(l.amount) FILTER (WHERE l.entry_type='disbursement'),0)::numeric(18,4) disbursed_amount
FROM program_budget_allocations b JOIN programs p ON p.id=b.program_id
LEFT JOIN ledger_transactions l ON l.program_id=b.program_id AND l.occurred_at::date BETWEEN b.period_start AND b.period_end
GROUP BY b.id,p.name;

INSERT INTO community_master_settings(community_id,application_name,theme_key,enabled_languages)
SELECT id,'Kindred','forest',ARRAY['en','ur','ar'] FROM communities WHERE slug='pcia-au'
ON CONFLICT(community_id) DO NOTHING;
