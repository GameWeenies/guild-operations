import { effectiveGuildRosterSql } from "./effective-roster.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { pool } from "../../db.js";

export type ControlledGuildMemberCharacter = {
  characterRecordId: string;
  identityId: string;
  guildId: string;
  rankIndex: number;
};

export async function controlledGuildMemberCharacters(
  identityId: string,
  guildId?: string,
): Promise<ControlledGuildMemberCharacter[]> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  const result = await pool.query<{
    character_record_id: string;
    identity_id: string;
    guild_id: string;
    rank_index: number;
  }>(
    `SELECT cr.character_record_id, ccr.identity_id, gr.guild_id, gr.rank_index
       FROM controlled_character_roster ccr
       JOIN character_roster cr ON cr.character_record_id = ccr.character_record_id
       JOIN ${effectiveGuildRosterSql} gr
         ON gr.character_record_id = cr.character_record_id
      WHERE ccr.identity_id = $1
        AND ccr.currently_controlled = true
        AND gr.guild_id = $2
      ORDER BY gr.rank_index, cr.character_record_id`,
    [identityId, resolvedGuildId],
  );

  return result.rows.map((row) => ({
    characterRecordId: row.character_record_id,
    identityId: row.identity_id,
    guildId: row.guild_id,
    rankIndex: row.rank_index,
  }));
}
