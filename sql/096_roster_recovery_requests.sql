-- A host request is not authorization to change the effective roster.
CREATE TABLE roster_recovery_requests (
  request_id uuid PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guilds(guild_id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  authorized_by_identity_id text
);
CREATE UNIQUE INDEX roster_recovery_one_pending ON roster_recovery_requests ((true))
 WHERE completed_at IS NULL AND cancelled_at IS NULL;
