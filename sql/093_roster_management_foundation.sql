-- Separate GO-declared membership from Blizzard-observed guild_roster.
-- This migration does not import Blizzard members or activate Manual authority;
-- lifecycle initialization and effective authority wiring follow in later PRs.

CREATE TABLE guild_roster_management (
  guild_id text PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE RESTRICT,
  mode text NOT NULL DEFAULT 'manual'
    CHECK (mode IN ('manual', 'blizzard_sync')),
  manual_initialized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE guild_roster_management IS
  'Persisted effective-roster source; manual_initialized_at is null until explicitly reviewed initialization.';

CREATE TABLE guild_declared_roster (
  guild_id text NOT NULL REFERENCES guilds(guild_id) ON DELETE RESTRICT,
  character_record_id uuid NOT NULL REFERENCES character_roster(character_record_id) ON DELETE RESTRICT,
  rank_index integer NOT NULL CHECK (rank_index BETWEEN 0 AND 9),
  declared_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, character_record_id),
  FOREIGN KEY (guild_id, rank_index)
    REFERENCES guild_rank_definitions(guild_id, rank_index)
);

COMMENT ON TABLE guild_declared_roster IS
  'GO-owned membership and rank declarations; never modified by Blizzard roster refresh.';

CREATE TABLE guild_roster_observation_state (
  guild_id text PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE RESTRICT,
  acquired_at timestamptz NOT NULL,
  source_last_modified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN guild_roster_observation_state.source_last_modified_at IS
  'Blizzard Last-Modified when provided; null does not imply that the source is fresh.';

-- Existing guilds remain uninitialized in Manual mode until an operator
-- explicitly reviews and imports a snapshot. Do not copy observed members.
INSERT INTO guild_roster_management (guild_id)
SELECT guild_id FROM guilds
ON CONFLICT (guild_id) DO NOTHING;
