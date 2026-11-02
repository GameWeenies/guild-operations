-- An application is a request for membership, never effective roster authority.
-- Character identity must already be recognized in GO's character catalog.
CREATE TABLE guild_roster_applications (
  application_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds(guild_id) ON DELETE RESTRICT,
  character_record_id uuid NOT NULL REFERENCES character_roster(character_record_id) ON DELETE RESTRICT,
  applicant_identity_id uuid NOT NULL REFERENCES identities(identity_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by_identity_id uuid REFERENCES identities(identity_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK ((status = 'pending' AND reviewed_at IS NULL AND reviewed_by_identity_id IS NULL)
    OR (status <> 'pending' AND reviewed_at IS NOT NULL AND reviewed_by_identity_id IS NOT NULL))
);
CREATE UNIQUE INDEX guild_roster_applications_pending_character_idx
  ON guild_roster_applications(guild_id, character_record_id) WHERE status = 'pending';
COMMENT ON TABLE guild_roster_applications IS
  'Pending applications are requests, not declared membership or effective rank.';
