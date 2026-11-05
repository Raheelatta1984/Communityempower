-- Guided demos, admin calendar, private repeat-case signals, and financial statement metadata.
-- This migration is idempotent and runs after the base and budget/master migrations.
ALTER TABLE members ADD COLUMN IF NOT EXISTS repeat_case_flag boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS repeat_case_flagged_by uuid REFERENCES members(id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS repeat_case_flagged_at timestamptz;
ALTER TABLE members ADD COLUMN IF NOT EXISTS repeat_case_private_note text;
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS exclude_from_close_monitoring boolean NOT NULL DEFAULT false;
UPDATE support_requests SET exclude_from_close_monitoring=true WHERE recurrence_plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS currencies (
  code char(3) PRIMARY KEY, name text NOT NULL, symbol text NOT NULL, minor_unit smallint NOT NULL DEFAULT 2 CHECK(minor_unit BETWEEN 0 AND 4),
  enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO currencies(code,name,symbol,minor_unit) VALUES
 ('AUD','Australian dollar','$',2),('PKR','Pakistani rupee','Rs',2),('NZD','New Zealand dollar','$',2),('GBP','Pound sterling','£',2),('USD','US dollar','$',2)
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS community_location_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES community_location_nodes(id) ON DELETE SET NULL,
  country_id uuid REFERENCES countries(id), level text NOT NULL CHECK(level IN ('country','state','city','suburb')),
  name text NOT NULL, code text, enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(community_id,parent_id,level,name)
);
CREATE INDEX IF NOT EXISTS idx_location_hierarchy ON community_location_nodes(community_id,parent_id,level,enabled);

CREATE TABLE IF NOT EXISTS case_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  program_id uuid REFERENCES programs(id) ON DELETE SET NULL, name text NOT NULL, description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true, created_by uuid REFERENCES members(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(community_id,name)
);

CREATE TABLE IF NOT EXISTS member_case_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  flag_type text NOT NULL CHECK(flag_type IN ('repeat_request','recurring_assistance','extra_follow_up')),
  reason text NOT NULL, admin_only boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES members(id), reviewed_by uuid REFERENCES members(id),
  reviewed_at timestamptz, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), cleared_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_member_case_flags_active ON member_case_flags(community_id,member_id,active);

CREATE TABLE IF NOT EXISTS community_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK(event_type IN ('commitment','due_date','follow_up','disbursement_reminder','marketing','meeting','community_event')),
  title text NOT NULL, description text NOT NULL DEFAULT '', starts_at timestamptz NOT NULL, ends_at timestamptz,
  visibility text NOT NULL DEFAULT 'admins' CHECK(visibility IN ('admins','members','public')),
  owner_id uuid REFERENCES members(id), case_id uuid REFERENCES support_requests(id), program_id uuid REFERENCES programs(id),
  reminder_at timestamptz, reminder_status text NOT NULL DEFAULT 'scheduled' CHECK(reminder_status IN ('scheduled','sent','dismissed')),
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
  created_by uuid NOT NULL REFERENCES members(id), updated_by uuid REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_community_start ON community_calendar_events(community_id,starts_at,status);
CREATE INDEX IF NOT EXISTS idx_calendar_events_admin_private ON community_calendar_events(community_id,visibility,starts_at);

CREATE TABLE IF NOT EXISTS financial_statement_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), statement_request_id uuid REFERENCES statement_requests(id),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  period_start date NOT NULL, period_end date NOT NULL, cadence text NOT NULL CHECK(cadence IN ('daily','weekly','monthly','quarterly','yearly')),
  currency_code char(3) NOT NULL, collection_total numeric(18,4) NOT NULL DEFAULT 0,
  disbursement_total numeric(18,4) NOT NULL DEFAULT 0, entry_count integer NOT NULL DEFAULT 0,
  format text NOT NULL DEFAULT 'pdf' CHECK(format IN ('pdf','csv')),
  status text NOT NULL DEFAULT 'ready' CHECK(status IN ('queued','generating','ready','failed')),
  file_url text, generated_by uuid REFERENCES members(id), generated_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_financial_statement_period ON financial_statement_runs(community_id,period_start,period_end,generated_at DESC);

-- Admin monitoring defaults to exclude system-created recurring installments, which remain in the audited case ledger.
CREATE OR REPLACE VIEW close_monitoring_cases AS
SELECT r.*, mask_person_name(m.display_name) masked_name, p.name program_name
FROM support_requests r
JOIN members m ON m.id=r.requester_id
JOIN programs p ON p.id=r.program_id
WHERE r.status NOT IN ('closed','declined') AND r.exclude_from_close_monitoring=false;
