import { changeManualRosterMember, ManualRosterOperationError, validCharacterRecordId, validRosterRank } from "./core/guild/manual-roster-operations.js";
import type { FastifyInstance } from "fastify";
import { manualRosterInitializationPreview, commitManualRosterInitialization, RosterInitializationConflict } from "./core/guild/roster-initialization-operation.js";
import { authenticatedIdentity, SESSION_COOKIE_NAME } from "./auth.js";
import { performGuildRefresh } from "./guild-refresh-operation.js";
import {
  configureGuildRefreshSchedule,
  InvalidGuildRefreshIntervalError,
} from "./core/guild/guild-refresh-schedule.js";
import {
  GUILD_REFRESH_CAPABILITY,
  GUILD_REFRESH_SCHEDULE_CONFIGURE_CAPABILITY,
  GuildCapabilityDeniedError,
  requireGuildCapability,
} from "./core/authority/guild-permissions.js";

export async function registerGuildRoutes(app: FastifyInstance): Promise<void> {
  app.get("/guild/roster/initialization", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });
    try {
      return reply.send(await manualRosterInitializationPreview(identity.identityId));
    } catch (error) {
      if (error instanceof Error && error.message === "roster_initialization_forbidden") {
        return reply.code(403).send({ error: "roster_initialization_forbidden" });
      }
      throw error;
    }
  });

  app.post<{ Body: { snapshot_version?: unknown; selected_character_record_ids?: unknown } }>(
    "/guild/roster/initialization", async (request, reply) => {
      const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
      if (!identity) return reply.code(401).send({ error: "not_authenticated" });
      const version = request.body?.snapshot_version;
      const selected = request.body?.selected_character_record_ids;
      if (typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version)
        || !Array.isArray(selected) || !selected.every((id) => typeof id === "string")) {
        return reply.code(400).send({ error: "invalid_roster_initialization_request" });
      }
      try {
        return reply.send(await commitManualRosterInitialization(identity.identityId, version, selected));
      } catch (error) {
        if (error instanceof RosterInitializationConflict) {
          return reply.code(409).send({ error: "roster_snapshot_changed" });
        }
        if (error instanceof Error && error.message === "roster_initialization_forbidden") {
          return reply.code(403).send({ error: "roster_initialization_forbidden" });
        }
        if (error instanceof Error && /Manual roster is not awaiting initialization/.test(error.message)) {
          return reply.code(409).send({ error: "roster_already_initialized" });
        }
        if (error instanceof Error && /Reviewed roster selection/.test(error.message)) {
          return reply.code(400).send({ error: "invalid_roster_selection" });
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { character_record_id?: unknown; action?: unknown; rank_index?: unknown } }>(
    "/guild/roster/members", async (request, reply) => {
      const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
      if (!identity) return reply.code(401).send({ error: "not_authenticated" });
      const { character_record_id: characterId, action, rank_index: rankIndex } = request.body ?? {};
      if (!validCharacterRecordId(characterId) ||
        (action !== "add" && action !== "remove" && action !== "rank") ||
        (action !== "remove" && !validRosterRank(rankIndex))) {
        return reply.code(400).send({ error: "invalid_roster_member_operation" });
      }
      try {
        return reply.send(await changeManualRosterMember({
          actorIdentityId: identity.identityId,
          characterRecordId: characterId,
          action,
          ...(action !== "remove" && validRosterRank(rankIndex) ? { rankIndex } : {}),
        }));
      } catch (error) {
        if (error instanceof ManualRosterOperationError) {
          const status = error.code === "roster_management_forbidden" ? 403 :
            error.code === "invalid_roster_member_operation" ? 400 :
            error.code === "unknown_character" || error.code === "unknown_guild_rank" ? 404 : 409;
          return reply.code(status).send({ error: error.code });
        }
        throw error;
      }
    },
  );

  app.post("/guild/refresh", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });

    try {
      const authority = await requireGuildCapability(identity.identityId, GUILD_REFRESH_CAPABILITY);
      const result = await performGuildRefresh({
        actorIdentityId: identity.identityId,
        onInspectionFailure: (error) => {
          request.log.error({ err: error }, "Operational inspection publication failed for guild refresh");
        },
      });
      return reply.send({
        guild_id: result.guildId,
        roster_count: result.rosterCount,
        requested_by: {
          identity_id: identity.identityId,
          effective_rank: authority.rankIndex,
        },
        reconciliation: {
          characters_targeted: result.reconciliation.charactersTargeted,
          profiles_updated: result.reconciliation.profilesUpdated,
          media_updated: result.reconciliation.mediaUpdated,
          failed_profiles: result.reconciliation.failedProfiles,
          failed_media: result.reconciliation.failedMedia,
          api_calls: result.reconciliation.apiCalls,
        },
      });
    } catch (error) {
      if (error instanceof GuildCapabilityDeniedError) {
        return reply.code(403).send({ error: "guild_capability_required", capability: error.capability });
      }
      throw error;
    }
  });

  app.put<{ Body: { enabled?: unknown; interval_seconds?: unknown } }>("/guild/refresh/schedule", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });

    try {
      await requireGuildCapability(identity.identityId, GUILD_REFRESH_SCHEDULE_CONFIGURE_CAPABILITY);
    } catch (error) {
      if (error instanceof GuildCapabilityDeniedError) {
        return reply.code(403).send({ error: "guild_capability_required", capability: error.capability });
      }
      throw error;
    }

    const enabled = request.body?.enabled;
    const intervalSeconds = request.body?.interval_seconds;
    if (typeof enabled !== "boolean") {
      return reply.code(400).send({ error: "enabled_must_be_boolean" });
    }
    if (typeof intervalSeconds !== "number") {
      return reply.code(400).send({ error: "invalid_interval_seconds" });
    }

    try {
      const schedule = await configureGuildRefreshSchedule({
        enabled,
        intervalSeconds,
      });

      return reply.send({
        enabled: schedule.enabled,
        interval_seconds: schedule.intervalSeconds,
        next_due_at_unix: schedule.nextDueAtUnix,
      });
    } catch (error) {
      if (error instanceof InvalidGuildRefreshIntervalError) {
        return reply.code(400).send({
          error: "invalid_interval_seconds",
          minimum_interval_seconds: error.minimumIntervalSeconds,
        });
      }
      throw error;
    }
  });
}
