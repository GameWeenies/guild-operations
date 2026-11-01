import { effectiveGuildRosterSql } from "../guild/effective-roster.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { pool } from "../../db.js";

export type CharacterRepresentation = {
  guildId: string;
  characterId: string;
  realmId: string;
  name: string;
  realmName: string | null;
  rankIndex: number | null;
  currentlyEligible: boolean;
  avatarUrl: string | null;
};

export async function selectCharacterRepresentation(
  identityId: string,
  realmId: string,
  characterId: string,
): Promise<CharacterRepresentation | null> {
  const binding = await requireOperationalInstallationGuildBinding();
  const result = await pool.query<{
    character_record_id: string;
    guild_id: string;
    character_id: string;
    realm_id: string;
    character_name: string;
    realm_name: string | null;
    rank_index: number;
    avatar_url: string | null;
  }>(
    `SELECT
       cr.character_record_id,
       gr.guild_id,
       cr.character_id,
       cr.realm_id,
       cr.name AS character_name,
       cr.realm_name,
       gr.rank_index,
       wcp.avatar_url
     FROM controlled_character_roster ccr
     JOIN character_roster cr ON cr.character_record_id = ccr.character_record_id
     JOIN ${effectiveGuildRosterSql} gr
       ON gr.character_record_id = cr.character_record_id
     LEFT JOIN wow_character_profiles wcp
       ON wcp.region = cr.region
      AND wcp.realm_id = cr.realm_id
      AND wcp.character_id = cr.character_id
     WHERE ccr.identity_id = $1
       AND ccr.currently_controlled = true
       AND gr.guild_id = $2
       AND cr.realm_id = $3
       AND cr.character_id = $4`,
    [identityId, binding.guildId, realmId, characterId],
  );

  if (!result.rowCount) return null;
  const character = result.rows[0];

  const existing = await pool.query<{ character_record_id: string }>(
    `SELECT character_record_id
       FROM identity_character_representations
      WHERE identity_id = $1
        AND guild_id = $2`,
    [identityId, binding.guildId],
  );
  const previous = existing.rows[0];
  const changed = !previous || previous.character_record_id !== character.character_record_id;

  if (changed) {
    await pool.query(
      `INSERT INTO identity_character_representations (
         identity_id, guild_id, character_record_id
       ) VALUES ($1,$2,$3)
       ON CONFLICT (identity_id, guild_id) DO UPDATE SET
         character_record_id = EXCLUDED.character_record_id,
         selected_at = now()`,
      [identityId, binding.guildId, character.character_record_id],
    );
  }

  return {
    guildId: character.guild_id,
    characterId: character.character_id,
    realmId: character.realm_id,
    name: character.character_name,
    realmName: character.realm_name,
    rankIndex: character.rank_index,
    currentlyEligible: true,
    avatarUrl: character.avatar_url,
  };
}

export async function characterRepresentationForIdentity(identityId: string): Promise<CharacterRepresentation | null> {
  const binding = await requireOperationalInstallationGuildBinding();
  const result = await pool.query<{
    guild_id: string;
    character_id: string;
    realm_id: string;
    name: string;
    realm_name: string | null;
    rank_index: number | null;
    currently_eligible: boolean;
    avatar_url: string | null;
  }>(
    `SELECT
       representation.guild_id,
       cr.character_id,
       cr.realm_id,
       cr.name,
       cr.realm_name,
       CASE WHEN gr.character_record_id IS NOT NULL THEN gr.rank_index ELSE NULL END AS rank_index,
       (ccr.currently_controlled IS TRUE AND gr.character_record_id IS NOT NULL) AS currently_eligible,
       wcp.avatar_url
     FROM identity_character_representations representation
     JOIN character_roster cr
       ON cr.character_record_id = representation.character_record_id
     LEFT JOIN controlled_character_roster ccr
       ON ccr.identity_id = representation.identity_id
      AND ccr.character_record_id = representation.character_record_id
     LEFT JOIN ${effectiveGuildRosterSql} gr
       ON gr.guild_id = representation.guild_id
      AND gr.character_record_id = representation.character_record_id
     LEFT JOIN wow_character_profiles wcp
       ON wcp.region = cr.region
      AND wcp.realm_id = cr.realm_id
      AND wcp.character_id = cr.character_id
     WHERE representation.identity_id = $1
       AND representation.guild_id = $2`,
    [identityId, binding.guildId],
  );

  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    guildId: row.guild_id,
    characterId: row.character_id,
    realmId: row.realm_id,
    name: row.name,
    realmName: row.realm_name,
    rankIndex: row.rank_index,
    currentlyEligible: row.currently_eligible,
    avatarUrl: row.avatar_url,
  };
}
