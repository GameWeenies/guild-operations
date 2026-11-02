import type { PoolClient } from "pg";

/** Require at least one controlled rank-zero identity in the declared roster.
 * Caller must hold the guild row lock before invoking this check. */
export async function hasDeclaredRosterAdministrator(client: PoolClient, guildId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM guild_declared_roster declared
       JOIN controlled_character_roster control
         ON control.character_record_id = declared.character_record_id
        AND control.currently_controlled = true
      WHERE declared.guild_id = $1 AND declared.rank_index = 0 LIMIT 1`,
    [guildId],
  );
  return (result.rowCount ?? 0) > 0;
}
