import { pool } from "../../db.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { canManageGuildRoster } from "../authority/guild-capability-policy.js";
import { ManualRosterOperationError } from "./manual-roster-operations.js";

/** Existing canonical characters that may be declared without a Blizzard guild-roster entry. */
export async function manualRosterCharacterCandidates(actorIdentityId: string) {
  const binding = await requireOperationalInstallationGuildBinding();
  if (!await canManageGuildRoster(actorIdentityId, binding.guildId)) {
    throw new ManualRosterOperationError("roster_management_forbidden");
  }
  const result = await pool.query<{
    character_record_id: string; name: string; realm_slug: string | null;
    level: number | null; observed_member: boolean; controlled: boolean;
  }>(
    `SELECT cr.character_record_id, cr.name, cr.realm_slug, cr.level,
            EXISTS (
              SELECT 1 FROM guild_roster observed
               WHERE observed.guild_id = $1 AND observed.character_record_id = cr.character_record_id
                 AND observed.currently_present = true
            ) AS observed_member,
            EXISTS (
              SELECT 1 FROM controlled_character_roster ccr
               WHERE ccr.character_record_id = cr.character_record_id AND ccr.currently_controlled = true
            ) AS controlled
       FROM character_roster cr
      WHERE cr.region = (SELECT region FROM guilds WHERE guild_id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM guild_declared_roster declared
           WHERE declared.guild_id = $1 AND declared.character_record_id = cr.character_record_id
        )
      ORDER BY cr.name, cr.realm_slug, cr.character_record_id`,
    [binding.guildId],
  );
  return { guildId: binding.guildId, characters: result.rows.map((row) => ({
    characterRecordId: row.character_record_id,
    name: row.name, realm: row.realm_slug, level: row.level,
    observedMember: row.observed_member, controlled: row.controlled,
  })) };
}
