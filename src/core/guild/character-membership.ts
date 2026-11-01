import { effectiveGuildRosterSql } from "./effective-roster.js";
import { config, type Region } from "../../config.js";
import { pool } from "../../db.js";

export type CharacterMembershipCoordinate = {
  guildId: string;
  region: Region;
  realmId: string;
  characterId: string;
};

export type CharacterMembership = CharacterMembershipCoordinate & {
  currentlyPresent: true;
  rankIndex: number;
  characterName: string;
  realmName: string | null;
  realmSlug: string | null;
};
export async function characterMembership(
  coordinate: CharacterMembershipCoordinate,
): Promise<CharacterMembership | null> {
  const result = await pool.query<{
    rank_index: number;
    character_name: string;
    realm_name: string | null;
    realm_slug: string | null;
  }>(
    `SELECT gr.rank_index, cr.name AS character_name, cr.realm_name, cr.realm_slug
       FROM guild_roster gr
       JOIN character_roster cr
         ON cr.character_record_id = gr.character_record_id
      WHERE gr.guild_id = $1
        AND cr.region = $2
        AND cr.realm_id = $3
        AND cr.character_id = $4
`,
    [coordinate.guildId, coordinate.region, coordinate.realmId, coordinate.characterId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    ...coordinate,
    currentlyPresent: true,
    rankIndex: row.rank_index,
    characterName: row.character_name,
    realmName: row.realm_name,
    realmSlug: row.realm_slug,
  };
}
