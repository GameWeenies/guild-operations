import { createHash } from "node:crypto";
import { pool, withTransaction } from "../../db.js";
import { installationGuildBinding } from "./guild-binding.js";
import { acquireGuildAuthority } from "../../blizzard.js";
import { parseRegion } from "../../config.js";
import { persistGuildRoster } from "../guild/guild-refresh.js";
import { resetDestinationGuildRoster } from "../guild/roster-initialization.js";
import { publishGuildRefreshObservation } from "../guild/guild-refresh-observers.js";

/** Host intent is persisted independently of the currently bound guild. */
async function pendingRebindRequest() {
  const result = await pool.query<{ request_id: string; region: string; realm_slug: string; guild_name: string }>(
    "SELECT request_id, region, realm_slug, guild_name FROM installation_rebind_requests WHERE completed_at IS NULL AND cancelled_at IS NULL",
  );
  return result.rows[0] ?? null;
}

async function resolvePendingRebind() {
  const request = await pendingRebindRequest();
  if (!request) return null;
  const region = parseRegion(request.region);
  if (!region) throw new Error("Pending rebind has invalid region");
  const nameSlug = request.guild_name.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const authority = await acquireGuildAuthority({ region, realmSlug: request.realm_slug, nameSlug });
  if (authority.profile.name.toLocaleLowerCase() !== request.guild_name.toLocaleLowerCase()
    || authority.profile.realm.slug !== request.realm_slug
    || String(authority.roster.guild.id) !== String(authority.profile.id)) {
    throw new Error("Blizzard guild identity does not match the pending destination");
  }
  return { request, target: { region }, authority: {
    ...authority,
    referenceHref: `https://${region}.api.blizzard.com/data/wow/guild/${encodeURIComponent(request.realm_slug)}/${encodeURIComponent(nameSlug)}?namespace=profile-${region}`,
  } };
}

export async function installationRebindPreview() {
  const pending = await resolvePendingRebind();
  if (!pending) return null;
  const binding = await installationGuildBinding();
  if (!binding?.authorizedAt) return null;
  const existing = await pool.query<{ name: string; realm_slug: string; region: string }>(
    "SELECT name, realm_slug, region FROM guilds WHERE guild_id = $1", [binding.guildId],
  );
  return {
    previous: { guildId: binding.guildId, ...existing.rows[0] },
    destination: { guildId: String(pending.authority.profile.id), name: pending.authority.profile.name,
      realmSlug: pending.authority.profile.realm.slug, region: pending.target.region },
  };
}

export async function authorizeInstallationRebind(identityId: string, sessionToken: string) {
  const pending = await resolvePendingRebind();
  if (!pending) throw new Error("No pending host rebinding request");
  const { request, target, authority } = pending;
  // Acquire the roster from Blizzard on every authorization attempt.
  const destinationId = String(authority.profile.id);
  const guildMasterCharacters = (authority.roster.members ?? [])
    .filter((member) => member.rank === 0)
    .map((member) => member.character)
    .filter((character) => character?.id && character.realm?.id)
    .map((character) => ({
      region: target.region,
      realmId: String(character.realm.id),
      characterId: String(character.id),
    }));
  if (!guildMasterCharacters.length) throw new Error("Destination guild has no verifiable Guild Master");
  const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
  const owned = await pool.query<{ character_id: string; realm_id: string; region: string }>(
    `SELECT cr.character_id, cr.realm_id, cr.region
       FROM controlled_character_roster ccr
       JOIN character_roster cr ON cr.character_record_id = ccr.character_record_id
      JOIN application_sessions sess ON sess.identity_id = ccr.identity_id
      WHERE ccr.identity_id = $1 AND ccr.currently_controlled = true
        AND sess.token_hash = $2 AND sess.revoked_at IS NULL AND sess.expires_at > now()
        AND sess.created_at >= now() - interval '5 minutes'
        AND ccr.last_seen_at >= sess.created_at - interval '5 seconds'`,
    [identityId, tokenHash],
  );
  if (!guildMasterCharacters.some((gm) =>
    owned.rows.some((row) => row.region === gm.region
      && row.realm_id === gm.realmId && row.character_id === gm.characterId))) {
    throw new Error("Current destination Guild Master authority is required");
  }

  const result = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(256, 1)");
    const bindingResult = await client.query<{ guild_id: string; authorized_at: Date | null }>(
      "SELECT guild_id, authorized_at FROM installation_guild_binding WHERE singleton = true FOR UPDATE",
    );
    const binding = bindingResult.rows[0];
    if (!binding?.authorized_at) throw new Error("Installation is not operational");
    if (binding.guild_id === destinationId) throw new Error("Destination guild is already bound; use refresh instead");
    const activeRequest = await client.query<{ request_id: string }>(
      "SELECT request_id FROM installation_rebind_requests WHERE request_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL FOR UPDATE",
      [request.request_id],
    );
    if (!activeRequest.rowCount) return { guildId: binding.guild_id, changed: false };

    const previousGuild = await client.query<{ name: string; realm_slug: string; region: string }>(
      "SELECT name, realm_slug, region FROM guilds WHERE guild_id = $1 FOR UPDATE",
      [binding.guild_id],
    );
    const guild = authority.profile;
    await client.query(
      `INSERT INTO guilds
         (guild_id, region, realm_id, name, realm_name, realm_slug, blizzard_reference_href)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (guild_id) DO UPDATE SET
         region=EXCLUDED.region, realm_id=EXCLUDED.realm_id,
         name=EXCLUDED.name, realm_name=EXCLUDED.realm_name,
         realm_slug=EXCLUDED.realm_slug,
         blizzard_reference_href=EXCLUDED.blizzard_reference_href,
         last_seen_at=now()`,
      [destinationId, target.region, String(guild.realm.id), guild.name,
        typeof guild.realm.name === "string" ? guild.realm.name : null,
        guild.realm.slug,
        authority.referenceHref],
    );
    // Returning to a previously bound guild must not restore its old declarations.
    await resetDestinationGuildRoster(client, destinationId);
    // Homepage copy and layout are guild-owned configuration, not history.
    // A guild returning to this installation must not recover its old homepage.
    await client.query("DELETE FROM guild_homepage_settings WHERE guild_id = $1", [destinationId]);
    await client.query("DELETE FROM guild_homepage_primitives WHERE guild_id = $1", [destinationId]);
    // Reset guild presentation, scheduled refresh, and plugin enablement.
    // Their historical activity records remain untouched.
    await client.query("DELETE FROM guild_presentation_settings WHERE guild_id = $1", [destinationId]);
    await client.query("DELETE FROM guild_refresh_schedule WHERE guild_id = $1", [destinationId]);
    await client.query("DELETE FROM guild_activity_plugin_enablement WHERE guild_id = $1", [destinationId]);
    // Rank labels and active flags are guild-owned presentation settings.
    // Reset them before roster observation reactivates current Blizzard ranks.
    await client.query(
      `UPDATE guild_rank_definitions
          SET display_name = 'Rank ' || rank_index::text,
              active = false, updated_at = now()
        WHERE guild_id = $1`,
      [destinationId],
    );
    await persistGuildRoster(client, destinationId, target.region, authority.roster);
    await client.query(
      "INSERT INTO guild_roster_observation_state (guild_id, acquired_at, source_last_modified_at) VALUES ($1, now(), NULL) ON CONFLICT (guild_id) DO UPDATE SET acquired_at = EXCLUDED.acquired_at, source_last_modified_at = NULL, updated_at = now()",
      [destinationId],
    );
    // Transport projections are replaceable pointers to the previous Discord server.
    // Remove them before allowing the destination guild to reconnect.
    await client.query("DELETE FROM discord_raffle_claim_projections");
    await client.query("DELETE FROM discord_raffle_projections");
    await client.query("DELETE FROM discord_raid_projections");
    await client.query("DELETE FROM discord_article_projections");
    // A destination previously hosted here must not recover its old capability grants.
    // Clear both policy configuration and its effective projection so the next
    // guild refresh initializes the destination from registered defaults.
    await client.query("DELETE FROM guild_capability_policy_configuration WHERE guild_id = $1", [destinationId]);
    await client.query("DELETE FROM guild_rank_capabilities WHERE guild_id = $1", [destinationId]);
    // Role mappings are configuration, not historical records. Do not reuse
    // mappings from an earlier binding of this same WoW guild.
    await client.query("DELETE FROM discord_rank_role_mappings WHERE guild_id = $1", [destinationId]);
    await client.query("DELETE FROM discord_rank_role_managed");
    // Discord destinations are installation-wide, not keyed by WoW guild.
    // Disable and clear the previous guild's routing before switching authority.
    await client.query(
      `UPDATE discord_integration_configuration
          SET enabled = false, discord_guild_id = NULL,
              article_channel_id = NULL, raid_channel_id = NULL,
              raffle_channel_id = NULL, updated_at = now()
        WHERE singleton = true`,
    );
    await client.query(
      `UPDATE installation_guild_binding SET
         guild_id=$1, bound_at=now(), bound_by_identity_id=$2,
         authorized_at=now(), authorized_by_identity_id=$2,
         authorization_kind='guild_master'
       WHERE singleton=true`,
      [destinationId, identityId],
    );
    await client.query(
      `INSERT INTO installation_guild_rebindings
         (previous_guild_id, destination_guild_id, authorized_by_identity_id,
          previous_guild_name, previous_realm_slug, previous_region,
          destination_guild_name, destination_realm_slug, destination_region)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [binding.guild_id, destinationId, identityId,
        previousGuild.rows[0]?.name ?? null, previousGuild.rows[0]?.realm_slug ?? null,
        previousGuild.rows[0]?.region ?? null,
        guild.name, guild.realm.slug, target.region],
    );
    await client.query("UPDATE installation_rebind_requests SET completed_at = now(), authorized_by_identity_id = $2 WHERE request_id = $1",
      [request.request_id, identityId]);
    return { guildId: destinationId, changed: true };
  });
  if (result.changed) {
    // The roster was persisted atomically with the binding. Notify refresh
    // observers and initialize defaults without requiring another Blizzard call.
    await publishGuildRefreshObservation({ guildId: result.guildId, changedIdentityIds: [] });
  }
  return result;
}
