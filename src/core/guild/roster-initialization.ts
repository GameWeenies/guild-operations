import type { PoolClient } from "pg";

/**
 * Record the new guild's Manual-mode initialization requirement without
 * importing any Blizzard observations into GO-declared membership.
 *
 * An existing binding must never reset a reviewed roster.
 */
export async function ensureGuildRosterInitialization(client: PoolClient, guildId: string): Promise<void> {
  await client.query(
    `INSERT INTO guild_roster_management (guild_id, mode, manual_initialized_at)
     VALUES ($1, 'manual', NULL)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId],
  );
}

/**
 * A rebind starts with fresh guild-owned roster declarations, even when
 * returning to a guild that was bound to this installation previously.
 * Historical character/identity and Blizzard observation records survive.
 * Must run in the same transaction as the installation binding change.
 */
export async function resetDestinationGuildRoster(client: PoolClient, guildId: string): Promise<void> {
  await client.query("DELETE FROM guild_declared_roster WHERE guild_id = $1", [guildId]);
  await client.query(
    `INSERT INTO guild_roster_management (guild_id, mode, manual_initialized_at, updated_at)
     VALUES ($1, 'manual', NULL, now())
     ON CONFLICT (guild_id) DO UPDATE SET
       mode = 'manual', manual_initialized_at = NULL, updated_at = now()`,
    [guildId],
  );
}
