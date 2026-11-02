import { createHash } from "node:crypto";
import { pool, withTransaction } from "../../db.js";
import { hasDeclaredRosterAdministrator } from "./manual-admin-continuity.js";
import { effectiveGuildRosterSql } from "./effective-roster.js";
import { guildieRosterTransitions, type GuildieRosterState } from "./guildie-roster-transitions.js";
import { publishEmission, deliverEmission } from "../../emissions/registry.js";
import { publishGuildRefreshObservation } from "./guild-refresh-observers.js";

export class RosterRecoveryError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function pendingRosterRecovery() {
  const result = await pool.query<{ request_id: string; guild_id: string; requested_at: Date }>(
    "SELECT request_id, guild_id, requested_at FROM roster_recovery_requests WHERE completed_at IS NULL AND cancelled_at IS NULL",
  );
  return result.rows[0] ?? null;
}

export async function authorizeRosterRecovery(identityId: string, sessionToken: string) {
  const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
  const result = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(256, 2)");
    const bindingResult = await client.query<{
      guild_id: string; authorized_by_identity_id: string | null;
      authorization_kind: string | null; verified_gm_character_record_id: string | null;
    }>(`SELECT guild_id, authorized_by_identity_id, authorization_kind, verified_gm_character_record_id
        FROM installation_guild_binding WHERE singleton = true AND authorized_at IS NOT NULL FOR UPDATE`);
    const binding = bindingResult.rows[0];
    if (!binding || binding.authorization_kind !== "guild_master" ||
      binding.authorized_by_identity_id !== identityId || !binding.verified_gm_character_record_id) {
      throw new RosterRecoveryError("verified_installation_gm_required");
    }
    const pending = await client.query<{ request_id: string; guild_id: string }>(
      "SELECT request_id, guild_id FROM roster_recovery_requests WHERE completed_at IS NULL AND cancelled_at IS NULL FOR UPDATE",
    );
    const request = pending.rows[0];
    if (!request || request.guild_id !== binding.guild_id) throw new RosterRecoveryError("recovery_not_pending");
    await client.query("SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE", [binding.guild_id]);
    const state = await client.query<{ mode: string; manual_initialized_at: Date | null }>(
      "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1 FOR UPDATE",
      [binding.guild_id],
    );
    if (state.rows[0]?.mode !== "blizzard_sync" || !state.rows[0].manual_initialized_at) {
      throw new RosterRecoveryError("recovery_not_eligible");
    }
    // Fresh session and renewed control of the exact character verified at installation.
    const verified = await client.query(
      `SELECT 1 FROM application_sessions sess
         JOIN controlled_character_roster control ON control.identity_id = sess.identity_id
        WHERE sess.identity_id = $1 AND sess.token_hash = $2
          AND sess.revoked_at IS NULL AND sess.expires_at > now()
          AND sess.created_at >= now() - interval '5 minutes'
          AND control.character_record_id = $3 AND control.currently_controlled = true
          AND control.last_seen_at >= sess.created_at - interval '5 seconds'
        LIMIT 1`,
      [identityId, tokenHash, binding.verified_gm_character_record_id],
    );
    if (!verified.rowCount) throw new RosterRecoveryError("fresh_verified_gm_control_required");
    const observedAdmin = await client.query(
      `SELECT 1 FROM guild_roster observed
         JOIN controlled_character_roster control ON control.character_record_id = observed.character_record_id
           AND control.currently_controlled = true
        WHERE observed.guild_id = $1 AND observed.currently_present = true AND observed.rank_index = 0 LIMIT 1`,
      [binding.guild_id],
    );
    if (observedAdmin.rowCount) throw new RosterRecoveryError("recovery_not_eligible");
    if (!await hasDeclaredRosterAdministrator(client, binding.guild_id)) {
      throw new RosterRecoveryError("manual_administrator_missing");
    }
    const guildies = async (): Promise<Map<string, GuildieRosterState>> => {
      const rows = await client.query<{ identity_id: string; rank_index: number }>(
        `SELECT control.identity_id, MIN(effective.rank_index)::integer AS rank_index
           FROM controlled_character_roster control
           JOIN ${effectiveGuildRosterSql} effective ON effective.character_record_id = control.character_record_id
          WHERE control.currently_controlled = true AND effective.guild_id = $1 GROUP BY control.identity_id`,
        [binding.guild_id],
      );
      return new Map(rows.rows.map((row) => [row.identity_id, { identityId: row.identity_id, rankIndex: row.rank_index }]));
    };
    const before = await guildies();
    await client.query("UPDATE guild_roster_management SET mode = 'manual', updated_at = now() WHERE guild_id = $1", [binding.guild_id]);
    const after = await guildies();
    const transitions = guildieRosterTransitions(before, after);
    const publications = [];
    for (const transition of transitions) {
      publications.push(await publishEmission(client, { code: transition.code, subject: transition.identityId }));
    }
    await client.query(
      "UPDATE roster_recovery_requests SET completed_at = now(), authorized_by_identity_id = $2 WHERE request_id = $1",
      [request.request_id, identityId],
    );
    return { guildId: binding.guild_id, transitions, publications };
  });
  for (const publication of result.publications) await deliverEmission(publication);
  await publishGuildRefreshObservation({
    guildId: result.guildId,
    changedIdentityIds: result.transitions.map((transition) => transition.identityId),
  });
  return { guildId: result.guildId, mode: "manual", recovered: true };
}
