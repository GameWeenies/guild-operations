import { effectiveGuildRosterSql } from "../guild/effective-roster.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { pool } from "../../db.js";

export type IdentityRepresentation = {
  identityId: string;
  displayName: string;
  recognitionKind: "main_character" | "identity";
  realmName: string | null;
};

export async function identityRepresentations(
  identityIds: Array<string | null | undefined>,
): Promise<Map<string, IdentityRepresentation>> {
  const uniqueIdentityIds = [...new Set(identityIds.filter((identityId): identityId is string => Boolean(identityId)))];
  if (uniqueIdentityIds.length === 0) return new Map();
  const guildId = (await requireOperationalInstallationGuildBinding()).guildId;

  const result = await pool.query<{
    identity_id: string;
    main_character_name: string | null;
    realm_name: string | null;
  }>(
    `SELECT
       i.identity_id AS identity_id,
       COALESCE(wcp.name, cr.name) AS main_character_name,
       COALESCE(wcp.realm_name, cr.realm_name) AS realm_name
     FROM identities i
     LEFT JOIN identity_character_representations representation
       ON representation.identity_id = i.identity_id
      AND representation.guild_id = $2
     LEFT JOIN character_roster cr
       ON cr.character_record_id = representation.character_record_id
     LEFT JOIN controlled_character_roster ccr
       ON ccr.identity_id = i.identity_id
      AND ccr.character_record_id = representation.character_record_id
      AND ccr.currently_controlled = true
     LEFT JOIN ${effectiveGuildRosterSql} gr
       ON gr.guild_id = representation.guild_id
      AND gr.character_record_id = representation.character_record_id
     LEFT JOIN wow_character_profiles wcp
       ON wcp.region = cr.region
      AND wcp.realm_id = cr.realm_id
      AND wcp.character_id = cr.character_id
     WHERE i.identity_id = ANY($1::uuid[])
       AND (cr.character_record_id IS NULL OR (ccr.character_record_id IS NOT NULL AND gr.character_record_id IS NOT NULL))`,
    [uniqueIdentityIds, guildId],
  );

  return new Map(result.rows.map((row) => {
    const recognitionKind = row.main_character_name ? "main_character" : "identity";
    const displayName = row.main_character_name ?? `Identity ${row.identity_id.slice(0, 8)}`;

    return [row.identity_id, {
      identityId: row.identity_id,
      displayName,
      recognitionKind,
      realmName: row.realm_name,
    } satisfies IdentityRepresentation];
  }));
}
