-- Release 2.4: single-vote enforcement, case documents, campaigns, communities,
-- languages, and ballpark (order-of-magnitude) allocation planning.
-- Idempotent. Apply after the portal-tools migration:
--   psql "$DATABASE_URL" -f db/upgrade-2026-11-release-2.4.sql

-- 1. One vote per member per case, enforced in the database.
CREATE TABLE IF NOT EXISTS case_votes (
  request_id uuid NOT NULL,
  member_id uuid NOT NULL,
  vote text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE case_votes ADD COLUMN IF NOT EXISTS voted_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE case_votes ADD COLUMN IF NOT EXISTS voter_community_id uuid REFERENCES communities(id);
ALTER TABLE case_votes ADD COLUMN IF NOT EXISTS vote_source text NOT NULL DEFAULT 'portal';
ALTER TABLE case_votes ADD COLUMN IF NOT EXISTS device_fingerprint text;
ALTER TABLE case_votes ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false;

-- Immutable vote: the database rejects a second row for the same member and case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_votes_one_per_member ON case_votes(request_id, member_id);
ALTER TABLE case_votes DROP CONSTRAINT IF EXISTS case_votes_vote_check;
ALTER TABLE case_votes ADD CONSTRAINT case_votes_vote_check CHECK(vote IN ('support','do_not_support','abstain'));
CREATE INDEX IF NOT EXISTS idx_case_votes_request ON case_votes(request_id);

-- A vote may never be edited after it is cast; only an admin-created new record may follow.
CREATE OR REPLACE FUNCTION case_vote_is_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Votes are final. A member may vote once per case; record a correction instead of editing.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_case_vote_immutable ON case_votes;
CREATE TRIGGER trg_case_vote_immutable BEFORE UPDATE ON case_votes
  FOR EACH ROW EXECUTE FUNCTION case_vote_is_immutable();

-- Tally used by the UI, so a returned visitor sees the recorded vote immediately.
CREATE OR REPLACE VIEW case_vote_tally AS
SELECT request_id,
       count(*) FILTER (WHERE vote='support')::int support_votes,
       count(*) FILTER (WHERE vote='do_not_support')::int oppose_votes,
       count(*) FILTER (WHERE vote='abstain')::int abstain_votes,
       count(*)::int total_votes
FROM case_votes GROUP BY request_id;

-- 2. Case documents, optionally mirrored into a community Google Drive account.
CREATE TABLE IF NOT EXISTS case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  request_id uuid REFERENCES support_requests(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES members(id),
  file_name text NOT NULL,
  mime_type text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  document_type text NOT NULL DEFAULT 'other'
    CHECK (document_type IN ('case_evidence','identity','quote_invoice','voucher','board_pack','campaign_material','other')),
  visibility text NOT NULL DEFAULT 'admins' CHECK (visibility IN ('admins','board','public')),
  reviewer_note text,
  storage_provider text NOT NULL DEFAULT 'browser' CHECK (storage_provider IN ('browser','google_drive','s3')),
  drive_file_id text,
  drive_folder_path text,
  drive_synced_at timestamptz,
  sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','failed','local_only')),
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_case_documents_case ON case_documents(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_documents_community ON case_documents(community_id, document_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_documents_drive ON case_documents(drive_file_id) WHERE drive_file_id IS NOT NULL;
-- Drive configuration lives with the community master settings.
ALTER TABLE community_master_settings ADD COLUMN IF NOT EXISTS google_drive_account text;
ALTER TABLE community_master_settings ADD COLUMN IF NOT EXISTS google_drive_folder text DEFAULT 'Kindred / Case files';
ALTER TABLE community_master_settings ADD COLUMN IF NOT EXISTS drive_scopes text DEFAULT 'https://www.googleapis.com/auth/drive.file';

-- 3. Campaigns: a case-linked go-fund programme alongside the monthly $1 collection.
CREATE TABLE IF NOT EXISTS fundraising_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  request_id uuid REFERENCES support_requests(id) ON DELETE SET NULL,
  program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  campaign_number text NOT NULL,
  title text NOT NULL,
  public_story text NOT NULL DEFAULT '',
  currency_code char(3) NOT NULL,
  target_amount numeric(18,4) NOT NULL CHECK (target_amount > 0),
  raised_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (raised_amount >= 0),
  disbursed_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (disbursed_amount >= 0),
  monthly_pool_contribution numeric(18,4) NOT NULL DEFAULT 0,
  external_provider text,
  external_campaign_url text,
  window_start date NOT NULL DEFAULT current_date,
  window_end date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','awaiting_board','active','funded','closed','cancelled')),
  board_approved_by uuid REFERENCES members(id),
  board_approved_at timestamptz,
  board_cap_amount numeric(18,4),
  surplus_returned_to_pool boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(community_id, campaign_number)
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON fundraising_campaigns(community_id, status, window_end);
CREATE INDEX IF NOT EXISTS idx_campaigns_case ON fundraising_campaigns(request_id);

CREATE TABLE IF NOT EXISTS campaign_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
  ledger_transaction_id uuid REFERENCES ledger_transactions(id),
  amount numeric(18,4) NOT NULL CHECK (amount > 0),
  currency_code char(3) NOT NULL,
  channel text NOT NULL DEFAULT 'external_provider',
  donor_display text,
  anonymous boolean NOT NULL DEFAULT true,
  received_at timestamptz NOT NULL DEFAULT now(),
  reconciled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_contributions ON campaign_contributions(campaign_id, received_at DESC);

-- 4. Ballpark planning: rough per-program amounts for quick action between budget cycles.
CREATE TABLE IF NOT EXISTS program_ballpark_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  currency_code char(3) NOT NULL,
  available_funds numeric(18,4) NOT NULL DEFAULT 0 CHECK (available_funds >= 0),
  reserve_percent smallint NOT NULL DEFAULT 15 CHECK (reserve_percent BETWEEN 0 AND 50),
  ballpark_percent smallint NOT NULL CHECK (ballpark_percent BETWEEN 0 AND 100),
  ballpark_amount numeric(18,4) NOT NULL GENERATED ALWAYS AS (round(available_funds * (100 - reserve_percent) / 100.0 * ballpark_percent / 100.0, 2)) STORED,
  quick_action_amount numeric(18,4) NOT NULL DEFAULT 0,
  is_planning_only boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(program_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_ballpark_period ON program_ballpark_allocations(community_id, period_start, period_end);

-- 5. Live language catalogue (the app ships 256; this table lets admins curate them).
CREATE TABLE IF NOT EXISTS portal_languages (
  code text PRIMARY KEY,
  label text NOT NULL,
  direction text NOT NULL DEFAULT 'ltr' CHECK (direction IN ('ltr','rtl')),
  interface_supported boolean NOT NULL DEFAULT false,
  catalogue_only boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE community_master_settings ADD COLUMN IF NOT EXISTS enabled_language_codes text[] NOT NULL DEFAULT ARRAY['en'];
ALTER TABLE community_master_settings ADD COLUMN IF NOT EXISTS default_language_code text NOT NULL DEFAULT 'en';

INSERT INTO portal_languages(code,label,direction,interface_supported,enabled) VALUES
 ('en','English','ltr',true,true),('ur','Urdu','rtl',true,true),('ar','Arabic','rtl',true,true),
 ('es','Spanish','ltr',true,true),('hi','Hindi','ltr',true,false),('bn','Bengali','ltr',true,false),
 ('pa','Punjabi','ltr',true,false),('zh','Chinese','ltr',true,false),('ps','Pashto','rtl',false,false),
 ('fa','Persian','rtl',false,false),('id','Indonesian','ltr',false,false),('tr','Turkish','ltr',false,false)
ON CONFLICT(code) DO NOTHING;

-- 6. Additional communities (multi-community support).
ALTER TABLE communities ADD COLUMN IF NOT EXISTS short_code text;
ALTER TABLE communities ADD COLUMN IF NOT EXISTS parent_community_id uuid REFERENCES communities(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_short_code ON communities(short_code) WHERE short_code IS NOT NULL;
INSERT INTO communities(name,slug,short_code,country_id,state_region,city)
SELECT 'Pakistani Community Melbourne','pcia-mel','MEL',id,'Victoria','Melbourne' FROM countries WHERE code='AU'
ON CONFLICT(slug) DO NOTHING;

-- 7. Case study walkthroughs, so hard cases are documented the same way every time.
CREATE TABLE IF NOT EXISTS case_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  request_id uuid REFERENCES support_requests(id) ON DELETE SET NULL,
  study_number text NOT NULL,
  title text NOT NULL,
  scale text,
  public_summary text NOT NULL DEFAULT '',
  situation text, approach text, verification text, board_presentation text, board_decision text,
  fundraising text, distribution text,
  lessons text[],
  requested_amount numeric(18,4) DEFAULT 0,
  collected_amount numeric(18,4) DEFAULT 0,
  distributed_amount numeric(18,4) DEFAULT 0,
  published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(community_id, study_number)
);

-- 8. Public-safe view for the transparency ledger to read campaign progress.
CREATE OR REPLACE VIEW public_campaign_progress AS
SELECT c.id,c.community_id,c.request_id,c.program_id,c.campaign_number,c.title,c.public_story,c.currency_code,
       c.target_amount,c.raised_amount,c.disbursed_amount,c.status,c.window_end,
       round(100.0 * c.raised_amount / NULLIF(c.target_amount,0), 1) percent_funded
FROM fundraising_campaigns c
WHERE c.status IN ('active','funded','closed');
