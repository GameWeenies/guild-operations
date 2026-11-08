CREATE TABLE raid_events (
  raid_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds(guild_id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  description text,
  occurs_start_unix bigint NOT NULL CHECK (occurs_start_unix > 0),
  occurs_end_unix bigint,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  difficulty text NOT NULL CHECK (difficulty IN ('normal', 'heroic', 'mythic')),
  created_by_identity_id uuid NOT NULL REFERENCES identities(identity_id) ON DELETE RESTRICT,
  created_at_unix bigint NOT NULL DEFAULT (extract(epoch FROM now())::bigint),
  updated_at_unix bigint NOT NULL DEFAULT (extract(epoch FROM now())::bigint),
  cancelled_at_unix bigint,
  cancelled_by_identity_id uuid REFERENCES identities(identity_id) ON DELETE RESTRICT,
  concluded_at_unix bigint,
  concluded_by_identity_id uuid REFERENCES identities(identity_id) ON DELETE RESTRICT,
  CHECK (occurs_end_unix IS NULL OR occurs_end_unix >= occurs_start_unix),
  CHECK ((cancelled_at_unix IS NULL) = (cancelled_by_identity_id IS NULL)),
  CHECK ((concluded_at_unix IS NULL) = (concluded_by_identity_id IS NULL)),
  CHECK (cancelled_at_unix IS NULL OR concluded_at_unix IS NULL)
);

CREATE TABLE raid_signup_rows (
  signup_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raid_id uuid NOT NULL REFERENCES raid_events(raid_id) ON DELETE CASCADE,
  created_at_unix bigint NOT NULL DEFAULT (extract(epoch FROM now())::bigint),
  updated_at_unix bigint NOT NULL DEFAULT (extract(epoch FROM now())::bigint),
  withdrawn_at_unix bigint,
  UNIQUE (raid_id, signup_row_id)
);

CREATE TABLE raid_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raid_id uuid NOT NULL REFERENCES raid_events(raid_id) ON DELETE CASCADE,
  signup_row_id uuid NOT NULL,
  selected_class text NOT NULL CHECK (length(btrim(selected_class)) > 0),
  selected_spec text NOT NULL CHECK (length(btrim(selected_spec)) > 0),
  selected_role text NOT NULL CHECK (selected_role IN ('tank', 'healer', 'damage')),
  assigned_by_identity_id uuid NOT NULL REFERENCES identities(identity_id) ON DELETE RESTRICT,
  assigned_at_unix bigint NOT NULL DEFAULT (extract(epoch FROM now())::bigint),
  UNIQUE (raid_id, signup_row_id),
  FOREIGN KEY (raid_id, signup_row_id) REFERENCES raid_signup_rows(raid_id, signup_row_id) ON DELETE CASCADE
);

CREATE TABLE raid_commitment_adjudications (
  raid_id uuid NOT NULL REFERENCES raid_events(raid_id) ON DELETE CASCADE,
  signup_row_id uuid NOT NULL REFERENCES raid_signup_rows(signup_row_id) ON DELETE CASCADE,
  fulfilled boolean NOT NULL,
  adjudicated_by_identity_id uuid NOT NULL REFERENCES identities(identity_id) ON DELETE RESTRICT,
  adjudicated_at_unix bigint NOT NULL DEFAULT (extract(epoch FROM now())::bigint),
  PRIMARY KEY (raid_id, signup_row_id)
);

CREATE TABLE raid_requirements (
  raid_id uuid NOT NULL REFERENCES raid_events(raid_id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  value text NOT NULL CHECK (length(btrim(value)) > 0),
  PRIMARY KEY (raid_id, position)
);

CREATE TABLE raid_action_history (
  action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raid_id uuid NOT NULL REFERENCES raid_events(raid_id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'modified', 'assignment_established', 'assignment_modified', 'assignment_withdrawn', 'signup_denied')),
  actor_identity_id uuid NOT NULL REFERENCES identities(identity_id) ON DELETE RESTRICT,
  occurred_at_unix bigint NOT NULL DEFAULT (extract(epoch FROM now())::bigint)
);

CREATE TABLE raid_signup_denials (
  raid_id uuid NOT NULL REFERENCES raid_events(raid_id) ON DELETE CASCADE,
  signup_row_id uuid NOT NULL REFERENCES raid_signup_rows(signup_row_id) ON DELETE CASCADE,
  denied_by_identity_id uuid NOT NULL REFERENCES identities(identity_id) ON DELETE RESTRICT,
  denied_at_unix bigint NOT NULL DEFAULT (extract(epoch FROM now())::bigint),
  PRIMARY KEY (raid_id, signup_row_id)
);

CREATE INDEX raid_events_occurs_idx ON raid_events(occurs_start_unix);
CREATE INDEX raid_events_active_occurs_idx ON raid_events(guild_id, occurs_start_unix) WHERE cancelled_at_unix IS NULL;
CREATE INDEX raid_assignments_raid_idx ON raid_assignments(raid_id, assigned_at_unix, assignment_id);
CREATE INDEX raid_action_history_raid_idx ON raid_action_history(raid_id, occurred_at_unix, action_id);
