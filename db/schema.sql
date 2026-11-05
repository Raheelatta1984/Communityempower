-- Kindred community-support portal schema for Neon (PostgreSQL 15+).
-- Apply with: psql "$DATABASE_URL" -f db/schema.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code char(2) NOT NULL UNIQUE,
  name text NOT NULL,
  currency_code char(3) NOT NULL,
  currency_symbol text NOT NULL,
  minor_unit smallint NOT NULL DEFAULT 2 CHECK (minor_unit BETWEEN 0 AND 4),
  min_amount numeric(18,4) NOT NULL DEFAULT 0.01 CHECK (min_amount > 0),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO countries(code,name,currency_code,currency_symbol,minor_unit,min_amount) VALUES
 ('AU','Australia','AUD','$',2,0.01),('PK','Pakistan','PKR','Rs',2,0.01),('NZ','New Zealand','NZD','$',2,0.01)
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  country_id uuid NOT NULL REFERENCES countries(id),
  state_region text, city text, suburb text,
  enabled boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  first_name_enc bytea,
  last_name_enc bytea,
  display_name text NOT NULL,
  country_id uuid REFERENCES countries(id),
  preferred_language text NOT NULL DEFAULT 'en',
  onboarding_status text NOT NULL DEFAULT 'pending' CHECK(onboarding_status IN ('pending','approved','declined','suspended')),
  reviewed_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community_memberships (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('member','reviewer','program_manager','board_member','admin','donor')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','declined','suspended')),
  reviewed_by uuid REFERENCES members(id), approved_by uuid REFERENCES members(id), approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(community_id,member_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON community_memberships(member_id,status);
CREATE TABLE IF NOT EXISTS programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name text NOT NULL, slug text NOT NULL, description text NOT NULL DEFAULT '', category text,
  enabled boolean NOT NULL DEFAULT true, monthly_goal numeric(18,4) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES members(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(community_id,slug)
);
CREATE TABLE IF NOT EXISTS gofund_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id),
  country_id uuid NOT NULL REFERENCES countries(id), period_start date NOT NULL, period_end date NOT NULL,
  title text NOT NULL, external_campaign_id text, currency_code char(3) NOT NULL,
  goal_amount numeric(18,4) NOT NULL DEFAULT 0, collected_amount numeric(18,4) NOT NULL DEFAULT 0,
  disbursed_amount numeric(18,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('scheduled','open','closed','disbursed','cancelled')),
  gofund_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(community_id,period_start)
);
CREATE INDEX IF NOT EXISTS idx_collections_period ON gofund_collections(period_start,status);
CREATE TABLE IF NOT EXISTS support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_number text NOT NULL UNIQUE,
  community_id uuid NOT NULL REFERENCES communities(id), program_id uuid NOT NULL REFERENCES programs(id),
  requester_id uuid NOT NULL REFERENCES members(id), country_id uuid NOT NULL REFERENCES countries(id),
  request_title text NOT NULL, request_body text NOT NULL, amount numeric(18,4) NOT NULL CHECK(amount > 0), currency_code char(3) NOT NULL,
  public_area jsonb NOT NULL DEFAULT '{}'::jsonb, -- locality only, never street address
  status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','admin_review','verification','manager_review','peer_review','board_review','approved','declined','fundraising','partially_funded','funded','distributed','closed')),
  privacy_level text NOT NULL DEFAULT 'masked' CHECK(privacy_level='masked'),
  submitted_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requests_community_status ON support_requests(community_id,status,submitted_at DESC);
CREATE TABLE IF NOT EXISTS workflow_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK(stage IN ('admin_intake','member_verification','program_validation','program_approval','peer_review','board_approval','board_onboarding')),
  reviewer_id uuid NOT NULL REFERENCES members(id), decision text NOT NULL CHECK(decision IN ('pending','approved','declined','needs_info','abstained')),
  note text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  UNIQUE(request_id,stage,reviewer_id)
);
CREATE TABLE IF NOT EXISTS case_votes (
  request_id uuid NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  vote text NOT NULL CHECK(vote IN ('support','do_not_support','abstain')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(request_id,member_id)
);
CREATE TABLE IF NOT EXISTS program_votes (
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  vote text NOT NULL CHECK(vote IN ('support','do_not_support','abstain')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(program_id,member_id)
);
CREATE TABLE IF NOT EXISTS board_discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id), body text NOT NULL, suggested_answer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id),
  collection_id uuid REFERENCES gofund_collections(id), request_id uuid REFERENCES support_requests(id), program_id uuid REFERENCES programs(id),
  country_id uuid NOT NULL REFERENCES countries(id), entry_type text NOT NULL CHECK(entry_type IN ('collection','disbursement','adjustment','refund')),
  amount numeric(18,4) NOT NULL CHECK(amount > 0), currency_code char(3) NOT NULL,
  description text NOT NULL, voucher_title text NOT NULL, voucher_number text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES members(id),
  public_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_community_time ON ledger_transactions(community_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS statement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id), requested_by uuid NOT NULL REFERENCES members(id),
  cadence text NOT NULL CHECK(cadence IN ('daily','weekly','monthly','quarterly','yearly')),
  period_start date NOT NULL, period_end date NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','generating','ready','failed')),
  file_url text, requested_at timestamptz NOT NULL DEFAULT now(), generated_at timestamptz, notified_at timestamptz
);
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind text NOT NULL, title text NOT NULL, body text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY, actor_id uuid REFERENCES members(id), community_id uuid REFERENCES communities(id),
  action text NOT NULL, entity_type text NOT NULL, entity_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Public name masker; raw names are stored encrypted by the application and never queried by public routes.
CREATE OR REPLACE FUNCTION mask_person_name(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n int := char_length(value);
BEGIN
  IF value IS NULL OR n=0 THEN RETURN ''; END IF;
  IF n=1 THEN RETURN left(value,1) || '•'; END IF;
  IF n=2 THEN RETURN left(value,1) || '•'; END IF;
  RETURN left(value,1) || repeat('•', greatest(n-2,1)) || right(value,1);
END; $$;
CREATE OR REPLACE FUNCTION mask_full_name(first_value text,last_value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(' ', mask_person_name(first_value), mask_person_name(last_value));
$$;

-- Seed demo community and sample programs only when schema is first installed.
INSERT INTO communities(name,slug,country_id,state_region,city,suburb)
SELECT 'Pakistani Community in Australia','pcia-au',id,'New South Wales','Sydney','Greater Sydney' FROM countries WHERE code='AU'
ON CONFLICT(slug) DO NOTHING;
INSERT INTO programs(community_id,name,slug,description,category,monthly_goal)
SELECT c.id,p.name,p.slug,p.description,p.category,p.goal FROM communities c CROSS JOIN (VALUES
 ('Emergency support fund','emergency-support','Voluntary emergency assistance for urgent medical needs and essential costs.','Emergency support',18000),
 ('Funeral & burial support','funeral-burial','Compassionate guidance and practical support for families after a bereavement.','Family care',6000),
 ('Community hall','community-hall','A long-term community space for family gatherings, learning, culture and connection.','Community building',12000),
 ('Legal support & advocacy','legal-advocacy','Qualified legal guidance and responsible advocacy, with children’s rights and safety at the centre.','Legal support',8000)
) AS p(name,slug,description,category,goal) WHERE c.slug='pcia-au'
ON CONFLICT(community_id,slug) DO NOTHING;
