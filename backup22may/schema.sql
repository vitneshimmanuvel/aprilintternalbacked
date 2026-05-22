CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- Table: users
-- ========================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  fcm_token VARCHAR(255),
  CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'manager'::character varying, 'visitor'::character varying])::text[])))
);

-- ========================================
-- Table: leads
-- ========================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  client_name VARCHAR(255) NOT NULL,
  client_email VARCHAR(255),
  client_phone VARCHAR(50),
  client_company VARCHAR(255),
  description TEXT,
  stage VARCHAR(50) DEFAULT 'meeting'::character varying NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium'::character varying,
  value DECIMAL(15,2),
  assigned_to UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  board_id UUID,
  custom_data JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT leads_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying])::text[]))),
  CONSTRAINT leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT leads_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT leads_board_id_fkey FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE SET NULL
);

-- ========================================
-- Table: lead_history
-- ========================================
CREATE TABLE lead_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL,
  user_id UUID NOT NULL,
  action VARCHAR(100) NOT NULL,
  field_changed VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT lead_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT lead_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- ========================================
-- Table: lead_notes
-- ========================================
CREATE TABLE lead_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL,
  user_id UUID NOT NULL,
  stage VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  is_edited BOOLEAN DEFAULT false,
  original_content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  money_collected BOOLEAN DEFAULT false,
  CONSTRAINT lead_notes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT lead_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- ========================================
-- Table: note_edits
-- ========================================
CREATE TABLE note_edits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id UUID NOT NULL,
  user_id UUID NOT NULL,
  previous_content TEXT NOT NULL,
  new_content TEXT NOT NULL,
  edited_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT note_edits_note_id_fkey FOREIGN KEY (note_id) REFERENCES lead_notes(id) ON DELETE CASCADE,
  CONSTRAINT note_edits_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- ========================================
-- Table: reminders
-- ========================================
CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL,
  user_id UUID NOT NULL,
  stage VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  remind_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  type VARCHAR(50) DEFAULT 'general'::character varying,
  recurrence VARCHAR(50) DEFAULT 'none'::character varying,
  is_notified BOOLEAN DEFAULT false,
  completion_status VARCHAR(50) DEFAULT 'completed'::character varying,
  completion_note TEXT,
  last_notified_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT reminders_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- ========================================
-- Table: board_users
-- ========================================
CREATE TABLE board_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL UNIQUE,
  role VARCHAR(20) DEFAULT 'member'::character varying,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT board_users_board_id_fkey FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  CONSTRAINT board_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ========================================
-- Table: boards
-- ========================================
CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  color VARCHAR(20) DEFAULT '#4f7cff'::character varying,
  icon VARCHAR(50) DEFAULT 'briefcase'::character varying,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT boards_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ========================================
-- Table: lead_visits
-- ========================================
CREATE TABLE lead_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL,
  created_by UUID NOT NULL,
  location VARCHAR(500) NOT NULL,
  distance_km DECIMAL(10,2) DEFAULT 0,
  visit_date TIMESTAMP WITH TIME ZONE NOT NULL,
  purpose VARCHAR(100) NOT NULL,
  notes TEXT,
  outcome VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT lead_visits_purpose_check CHECK (((purpose)::text = ANY ((ARRAY['site_visit'::character varying, 'client_meeting'::character varying, 'follow_up_visit'::character varying, 'final_inspection'::character varying, 'other'::character varying])::text[]))),
  CONSTRAINT lead_visits_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying, 'pending'::character varying])::text[]))),
  CONSTRAINT lead_visits_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT lead_visits_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- ========================================
-- Table: settings
-- ========================================
CREATE TABLE settings (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  board_id UUID PRIMARY KEY,
  CONSTRAINT settings_board_id_fkey FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

-- ========================================
-- Table: visit_participants
-- ========================================
CREATE TABLE visit_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  visit_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL UNIQUE,
  distance_km DECIMAL(10,2) DEFAULT 0,
  travel_mode VARCHAR(50),
  travel_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT visit_participants_travel_mode_check CHECK (((travel_mode)::text = ANY ((ARRAY['car'::character varying, 'bike'::character varying, 'public_transport'::character varying, 'walk'::character varying, 'other'::character varying])::text[]))),
  CONSTRAINT visit_participants_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES lead_visits(id) ON DELETE CASCADE,
  CONSTRAINT visit_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- ========================================
-- Indexes
-- ========================================
CREATE INDEX idx_board_users_board_id ON public.board_users USING btree (board_id);
CREATE INDEX idx_board_users_user_id ON public.board_users USING btree (user_id);
CREATE INDEX idx_lead_history_lead_id ON public.lead_history USING btree (lead_id);
CREATE INDEX idx_lead_notes_lead_id ON public.lead_notes USING btree (lead_id);
CREATE INDEX idx_lead_visits_created_by ON public.lead_visits USING btree (created_by);
CREATE INDEX idx_lead_visits_lead_id ON public.lead_visits USING btree (lead_id);
CREATE INDEX idx_lead_visits_visit_date ON public.lead_visits USING btree (visit_date);
CREATE INDEX idx_leads_assigned_to ON public.leads USING btree (assigned_to);
CREATE INDEX idx_leads_board_id ON public.leads USING btree (board_id);
CREATE INDEX idx_leads_created_by ON public.leads USING btree (created_by);
CREATE INDEX idx_leads_stage ON public.leads USING btree (stage);
CREATE INDEX idx_reminders_cron ON public.reminders USING btree (is_completed, remind_at) WHERE (is_completed = false);
CREATE INDEX idx_reminders_lead_id ON public.reminders USING btree (lead_id);
CREATE INDEX idx_reminders_remind_at ON public.reminders USING btree (remind_at);
CREATE INDEX idx_reminders_user_completed ON public.reminders USING btree (user_id, is_completed);
CREATE INDEX idx_reminders_user_id ON public.reminders USING btree (user_id);
CREATE INDEX idx_settings_board_id ON public.settings USING btree (board_id);
CREATE INDEX idx_visit_participants_user_id ON public.visit_participants USING btree (user_id);
CREATE INDEX idx_visit_participants_visit_id ON public.visit_participants USING btree (visit_id);

-- ========================================
-- Functions
-- ========================================
CREATE OR REPLACE FUNCTION public.uuid_nil()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_nil$function$
;

CREATE OR REPLACE FUNCTION public.uuid_ns_dns()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_dns$function$
;

CREATE OR REPLACE FUNCTION public.uuid_ns_url()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_url$function$
;

CREATE OR REPLACE FUNCTION public.uuid_ns_oid()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_oid$function$
;

CREATE OR REPLACE FUNCTION public.uuid_ns_x500()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_x500$function$
;

CREATE OR REPLACE FUNCTION public.uuid_generate_v1()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1$function$
;

CREATE OR REPLACE FUNCTION public.uuid_generate_v1mc()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1mc$function$
;

CREATE OR REPLACE FUNCTION public.uuid_generate_v3(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v3$function$
;

CREATE OR REPLACE FUNCTION public.uuid_generate_v4()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v4$function$
;

CREATE OR REPLACE FUNCTION public.uuid_generate_v5(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v5$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

-- ========================================
-- Triggers
-- ========================================
CREATE TRIGGER update_lead_notes_updated_at BEFORE UPDATE ON public.lead_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lead_visits_updated_at BEFORE UPDATE ON public.lead_visits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_boards_updated_at BEFORE UPDATE ON public.boards FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
