import { pool, withTransaction } from "../../db.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { canManageGuildRoster } from "../authority/guild-capability-policy.js";
import { validCharacterRecordId } from "./manual-roster-operations.js";

export class RosterApplicationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function submitRosterApplication(identityId: string, characterRecordId: string) {
  if (!validCharacterRecordId(characterRecordId)) throw new RosterApplicationError("invalid_character");
  const { guildId } = await requireOperationalInstallationGuildBinding();
  return withTransaction(async (client) => {
    await client.query("SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE", [guildId]);
    const management = await client.query<{ mode: string; manual_initialized_at: Date | null }>(
      "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1", [guildId],
    );
    if (management.rows[0]?.mode !== "manual" || !management.rows[0].manual_initialized_at) {
      throw new RosterApplicationError("manual_roster_not_active");
    }
    const controlled = await client.query(
      "SELECT 1 FROM controlled_character_roster WHERE identity_id = $1 AND character_record_id = $2 AND currently_controlled = true",
      [identityId, characterRecordId],
    );
    if (!controlled.rowCount) throw new RosterApplicationError("character_not_controlled");
    const declared = await client.query(
      "SELECT 1 FROM guild_declared_roster WHERE guild_id = $1 AND character_record_id = $2",
      [guildId, characterRecordId],
    );
    if (declared.rowCount) throw new RosterApplicationError("already_member");
    const inserted = await client.query<{ application_id: string }>(
      `INSERT INTO guild_roster_applications (guild_id, character_record_id, applicant_identity_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING application_id`,
      [guildId, characterRecordId, identityId],
    );
    if (!inserted.rowCount) throw new RosterApplicationError("application_pending");
    return { applicationId: inserted.rows[0].application_id, status: "pending" };
  });
}

export async function pendingRosterApplications(actorIdentityId: string) {
  const { guildId } = await requireOperationalInstallationGuildBinding();
  if (!await canManageGuildRoster(actorIdentityId, guildId)) throw new RosterApplicationError("roster_management_forbidden");
  const result = await pool.query(
    `SELECT a.application_id, a.character_record_id, a.applicant_identity_id,
            a.created_at, cr.name, cr.realm_slug, cr.level
       FROM guild_roster_applications a
       JOIN character_roster cr ON cr.character_record_id = a.character_record_id
      WHERE a.guild_id = $1 AND a.status = 'pending'
      ORDER BY a.created_at, a.application_id`, [guildId],
  );
  return { applications: result.rows };
}

export async function reviewRosterApplication(actorIdentityId: string, applicationId: string) {
  const { guildId } = await requireOperationalInstallationGuildBinding();
  if (!await canManageGuildRoster(actorIdentityId, guildId)) throw new RosterApplicationError("roster_management_forbidden");
  if (!validCharacterRecordId(applicationId)) {
    throw new RosterApplicationError("invalid_application_review");
  }
  return withTransaction(async (client) => {
    await client.query("SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE", [guildId]);
    const result = await client.query(
      `UPDATE guild_roster_applications SET status = 'rejected',
           reviewed_by_identity_id = $3, reviewed_at = now()
        WHERE guild_id = $1 AND application_id = $2 AND status = 'pending'`,
      [guildId, applicationId, actorIdentityId],
    );
    if (!result.rowCount) throw new RosterApplicationError("application_not_pending");
    return { applicationId, status: "rejected" };
  });
}
