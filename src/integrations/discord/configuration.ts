import { pool, withTransaction } from "../../db.js";
import { hostDiscordCredentials } from "./host-credentials.js";


// Coordinate configuration writes with installation rebinding. The shared lock
// permits ordinary configuration operations concurrently but excludes the
// rebinding transaction while an update is in progress.
async function updateDiscordConfiguration(query: string, parameters: unknown[], expectedBinding?: { guildId: string; boundAt: Date }): Promise<number> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock_shared(256, 1)");
    if (expectedBinding !== undefined) {
      const binding = await client.query<{ guild_id: string; bound_at: Date }>(
        "SELECT guild_id, bound_at FROM installation_guild_binding WHERE singleton = true",
      );
      if (binding.rows[0]?.guild_id !== expectedBinding.guildId ||
        binding.rows[0]?.bound_at.getTime() !== expectedBinding.boundAt.getTime()) return 0;
    }
    const result = await client.query(query, parameters);
    return result.rowCount ?? 0;
  });
}

export type DiscordIntegrationConfiguration = {
  enabled: boolean;
  applicationId: string;
  applicationName: string | null;
  applicationVerifiedAt: Date | null;
  interactionPublicKey: string | null;
  botUserId: string | null;
  botUsername: string | null;
  clientSecret: string;
  botToken: string;
  discordGuildId: string | null;
  articleChannelId: string | null;
  raidChannelId: string | null;
  allowRaidSignups: boolean;
  raffleChannelId: string | null;
};

export async function discordIntegrationConfiguration(): Promise<DiscordIntegrationConfiguration | null> {
  const hostCredentials = hostDiscordCredentials();
  const result = await pool.query<{
    enabled: boolean;
    application_id: string;
    application_name: string | null;
    application_verified_at: Date | null;
    interaction_public_key: string | null;
    bot_user_id: string | null;
    bot_username: string | null;
    discord_guild_id: string | null;
    article_channel_id: string | null;
    raid_channel_id: string | null;
    allow_raid_signups: boolean;
    raffle_channel_id: string | null;
  }>(`SELECT enabled, application_id, application_name, application_verified_at, interaction_public_key, bot_user_id, bot_username, discord_guild_id, article_channel_id, raid_channel_id, raffle_channel_id, allow_raid_signups
      FROM discord_integration_configuration
      WHERE singleton = true`);
  const row = result.rows[0];
  if (!hostCredentials) return null;
  if (!row && hostCredentials) {
    return {
      enabled: false,
      applicationId: hostCredentials.applicationId,
      applicationName: null,
      applicationVerifiedAt: null,
      interactionPublicKey: null,
      botUserId: null,
      botUsername: null,
      clientSecret: hostCredentials.clientSecret,
      botToken: hostCredentials.botToken,
      discordGuildId: null,
      articleChannelId: null,
      raidChannelId: null,
      allowRaidSignups: true,
      raffleChannelId: null,
    };
  }
  if (!row) return null;
  const credentialsMatch = hostCredentials.applicationId === row.application_id;
  return {
    enabled: row.enabled && credentialsMatch,
    applicationId: hostCredentials.applicationId,
    applicationName: credentialsMatch ? row.application_name : null,
    applicationVerifiedAt: credentialsMatch ? row.application_verified_at : null,
    interactionPublicKey: credentialsMatch ? row.interaction_public_key : null,
    botUserId: credentialsMatch ? row.bot_user_id : null,
    botUsername: credentialsMatch ? row.bot_username : null,
    clientSecret: hostCredentials.clientSecret,
    botToken: hostCredentials.botToken,
    discordGuildId: credentialsMatch ? row.discord_guild_id : null,
    articleChannelId: credentialsMatch ? row.article_channel_id : null,
    raidChannelId: credentialsMatch ? row.raid_channel_id : null,
    allowRaidSignups: row.allow_raid_signups,
    raffleChannelId: credentialsMatch ? row.raffle_channel_id : null,
  };
}

/** Establish the guild-owned Discord record from verified host application credentials.
 * Existing guild settings are preserved when the application identity is unchanged.
 */
export async function establishHostDiscordApplication(input: {
  applicationName: string;
  botUserId: string | null;
  botUsername: string | null;
  interactionPublicKey: string;
}): Promise<void> {
  const host = hostDiscordCredentials();
  if (!host) throw new Error("discord_host_configuration_required");
  if (!/^[0-9a-f]{64}$/i.test(input.interactionPublicKey)) throw new Error("invalid_discord_interaction_public_key");
  await updateDiscordConfiguration(
    `INSERT INTO discord_integration_configuration (
       singleton, enabled, application_id,
       application_name, application_verified_at, bot_user_id, bot_username, interaction_public_key
     ) VALUES (true, false, $1, $2, now(), $3, $4, $5)
     ON CONFLICT (singleton) DO UPDATE SET
       application_name = EXCLUDED.application_name,
       application_verified_at = EXCLUDED.application_verified_at,
       bot_user_id = EXCLUDED.bot_user_id,
       bot_username = EXCLUDED.bot_username,
       interaction_public_key = EXCLUDED.interaction_public_key,
       updated_at = now()
     WHERE discord_integration_configuration.application_id = EXCLUDED.application_id`,
    [host.applicationId, input.applicationName, input.botUserId, input.botUsername, input.interactionPublicKey],
  );
}

export function discordApplicationReplacementState(
  stored: { applicationId: string; discordGuildId: string | null } | null,
  hostApplicationId: string | null,
): { previousServerId: string | null } | null {
  if (!stored || !hostApplicationId || stored.applicationId === hostApplicationId) return null;
  return { previousServerId: stored.discordGuildId };
}

export async function pendingDiscordApplicationReplacement(): Promise<{ previousServerId: string | null } | null> {
  const host = hostDiscordCredentials();
  if (!host) return null;
  const result = await pool.query<{ application_id: string; discord_guild_id: string | null }>(
    "SELECT application_id, discord_guild_id FROM discord_integration_configuration WHERE singleton = true",
  );
  const row = result.rows[0];
  return discordApplicationReplacementState(row ? { applicationId: row.application_id, discordGuildId: row.discord_guild_id } : null, host.applicationId);
}

/** Explicit guild-authorized replacement. The new bot must already be verified and
 * present in the previously bound server; old destinations remain stored for review.
 * Integration stays disabled until the operator enables it again.
 */
export async function reconnectHostDiscordApplication(input: {
  applicationName: string;
  botUserId: string | null;
  botUsername: string | null;
  interactionPublicKey: string;
  discordGuildId: string | null;
  expectedBinding: { guildId: string; boundAt: Date };
}): Promise<boolean> {
  const host = hostDiscordCredentials();
  if (!host) throw new Error("discord_host_configuration_required");
  if (!/^[0-9a-f]{64}$/i.test(input.interactionPublicKey)) throw new Error("invalid_discord_interaction_public_key");
  const result = await updateDiscordConfiguration(
    `UPDATE discord_integration_configuration
       SET enabled = false, application_id = $1, application_name = $2,
           application_verified_at = now(), bot_user_id = $3, bot_username = $4,
           interaction_public_key = $5, updated_at = now()
       WHERE singleton = true AND application_id <> $1 AND discord_guild_id IS NOT DISTINCT FROM $6`,
    [host.applicationId, input.applicationName, input.botUserId, input.botUsername,
      input.interactionPublicKey, input.discordGuildId], input.expectedBinding,
  );
  return result === 1;
}

export async function markDiscordApplicationEstablished(applicationName: string, botUserId: string | null, botUsername: string | null, interactionPublicKey: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(interactionPublicKey)) throw new Error("invalid_discord_interaction_public_key");
  await updateDiscordConfiguration("UPDATE discord_integration_configuration SET application_name = $1, application_verified_at = now(), bot_user_id = $2, bot_username = $3, interaction_public_key = $4, updated_at = now() WHERE singleton = true", [applicationName, botUserId, botUsername, interactionPublicKey]);
}

export async function establishDiscordGuildBinding(discordGuildId: string, expectedBinding: { guildId: string; boundAt: Date }): Promise<boolean> {
  const value = discordGuildId.trim();
  if (!value) throw new Error("invalid_discord_guild_id");
  return (await updateDiscordConfiguration(`UPDATE discord_integration_configuration
       SET discord_guild_id = $1, updated_at = now()
     WHERE singleton = true AND discord_guild_id IS NULL`, [value], expectedBinding)) === 1;
}

export async function setDiscordIntegrationEnabled(enabled: boolean, expectedBinding: { guildId: string; boundAt: Date }): Promise<boolean> {
  return (await updateDiscordConfiguration(
    "UPDATE discord_integration_configuration SET enabled = $1, updated_at = now() WHERE singleton = true",
    [enabled], expectedBinding,
  )) === 1;
}

/** Enable only the application, server and destinations that passed validation.
 * The host identity is checked again after external Discord API requests.
 */
export async function enableVerifiedDiscordIntegration(expected: {
  applicationId: string;
  discordGuildId: string;
  botUserId: string;
  articleChannelId: string | null;
  raidChannelId: string | null;
  raffleChannelId: string | null;
  expectedBinding: { guildId: string; boundAt: Date };
}): Promise<boolean> {
  const host = hostDiscordCredentials();
  if (!host || host.applicationId !== expected.applicationId) return false;
  const result = await updateDiscordConfiguration(
    `UPDATE discord_integration_configuration SET enabled = true, updated_at = now()
      WHERE singleton = true AND application_id = $1 AND discord_guild_id = $2
        AND bot_user_id = $3 AND application_verified_at IS NOT NULL
        AND article_channel_id IS NOT DISTINCT FROM $4
        AND raid_channel_id IS NOT DISTINCT FROM $5
        AND raffle_channel_id IS NOT DISTINCT FROM $6`,
    [expected.applicationId, expected.discordGuildId, expected.botUserId,
      expected.articleChannelId, expected.raidChannelId, expected.raffleChannelId], expected.expectedBinding,
  );
  return result === 1;
}

/** The configured destination is optional; an empty selection disables article projection. */
export async function setDiscordArticleChannel(channelId: string | null, expectedBinding: { guildId: string; boundAt: Date }): Promise<boolean> {
  if (channelId !== null && !/^\d+$/.test(channelId)) throw new Error("invalid_discord_article_channel");
  return (await updateDiscordConfiguration(
    "UPDATE discord_integration_configuration SET article_channel_id = $1, updated_at = now() WHERE singleton = true AND enabled = true",
    [channelId], expectedBinding,
  )) === 1;
}

/** Optional destination for future Raid projections. */
export async function setDiscordRaidChannel(channelId: string | null, expectedBinding: { guildId: string; boundAt: Date }): Promise<boolean> {
  if (channelId !== null && !/^\d+$/.test(channelId)) throw new Error("invalid_discord_raid_channel");
  return (await updateDiscordConfiguration(
    "UPDATE discord_integration_configuration SET raid_channel_id = $1, updated_at = now() WHERE singleton = true AND enabled = true",
    [channelId], expectedBinding,
  )) === 1;
}

/** Optional destination for Raffle announcements and claim ledger threads. */
export async function setDiscordRaffleChannel(channelId: string | null, expectedBinding: { guildId: string; boundAt: Date }): Promise<boolean> {
  if (channelId !== null && !/^[0-9]+$/.test(channelId)) throw new Error("invalid_discord_raffle_channel");
  return (await updateDiscordConfiguration(
    "UPDATE discord_integration_configuration SET raffle_channel_id = $1, updated_at = now() WHERE singleton = true AND enabled = true",
    [channelId], expectedBinding,
  )) === 1;
}

/** Control new Discord Raid offers independently of publication destinations. */
export async function setDiscordRaidSignupsAllowed(allowed: boolean, expectedBinding: { guildId: string; boundAt: Date }): Promise<boolean> {
  return (await updateDiscordConfiguration(
    "UPDATE discord_integration_configuration SET allow_raid_signups = $1, updated_at = now() WHERE singleton = true",
    [allowed], expectedBinding,
  )) === 1;
}
