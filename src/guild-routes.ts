import { activateBlizzardSync, activateManualWithReconciliation, RosterModeTransitionError } from "./core/guild/roster-mode-transitions.js";
import { rosterReconciliationPreview } from "./core/guild/roster-reconciliation.js";
import { manualRosterCharacterCandidates } from "./core/guild/manual-roster-character-candidates.js";
import { submitRosterApplication, pendingRosterApplications, reviewRosterApplication, RosterApplicationError } from "./core/guild/roster-applications.js";
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

  app.post<{ Body: { acknowledge_stale_roster_risk?: unknown } }>(
    "/guild/roster/mode/blizzard-sync", async (request, reply) => {
      const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
      if (!identity) return reply.code(401).send({ error: "not_authenticated" });
      if (request.body?.acknowledge_stale_roster_risk !== true) {
        return reply.code(400).send({ error: "risk_acknowledgment_required" });
      }
      try {
        return reply.send(await activateBlizzardSync(identity.identityId, true));
      } catch (error) {
        if (error instanceof RosterModeTransitionError) {
          return reply.code(error.code === "roster_management_forbidden" ? 403 : 409).send({ error: error.code });
        }
        throw error;
      }
    },
  );

  app.post<{ Body: { snapshot_version?: unknown; selected_character_record_ids?: unknown } }>(
    "/guild/roster/mode/manual", async (request, reply) => {
      const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
      if (!identity) return reply.code(401).send({ error: "not_authenticated" });
      const version = request.body?.snapshot_version;
      const selected = request.body?.selected_character_record_ids;
      if (typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version) ||
          !Array.isArray(selected) || !selected.every(validCharacterRecordId)) {
        return reply.code(400).send({ error: "invalid_reconciliation_selection" });
      }
      try {
        return reply.send(await activateManualWithReconciliation(identity.identityId, version, selected));
      } catch (error) {
        if (error instanceof RosterModeTransitionError) {
          const status = error.code === "roster_management_forbidden" ? 403 :
            error.code === "invalid_reconciliation_selection" ? 400 : 409;
          return reply.code(status).send({ error: error.code });
        }
        throw error;
      }
    },
  );

  app.get("/guild/roster/reconciliation", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });
    try {
      return reply.send(await rosterReconciliationPreview(identity.identityId));
    } catch (error) {
      if (error instanceof Error && error.message === "roster_management_forbidden") {
        return reply.code(403).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get("/guild/roster/character-candidates", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });
    try {
      return reply.send(await manualRosterCharacterCandidates(identity.identityId));
    } catch (error) {
      if (error instanceof ManualRosterOperationError && error.code === "roster_management_forbidden") {
        return reply.code(403).send({ error: error.code });
      }
      throw error;
    }
  });

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

  app.post<{ Body: { character_record_id?: unknown } }>("/guild/roster/applications", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });
    try {
      return reply.code(201).send(await submitRosterApplication(identity.identityId, request.body?.character_record_id as string));
    } catch (error) {
      if (error instanceof RosterApplicationError) {
        return reply.code(error.code === "invalid_character" ? 400 :
          error.code === "character_not_controlled" ? 403 : 409).send({ error: error.code });
      }
      throw error;
    }
  });

  app.get("/guild/roster/applications", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });
    try {
      return reply.send(await pendingRosterApplications(identity.identityId));
    } catch (error) {
      if (error instanceof RosterApplicationError && error.code === "roster_management_forbidden") {
        return reply.code(403).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post<{ Params: { applicationId: string } }>("/guild/roster/applications/:applicationId/reject", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });
    try {
      return reply.send(await reviewRosterApplication(identity.identityId, request.params.applicationId));
    } catch (error) {
      if (error instanceof RosterApplicationError) {
        return reply.code(error.code === "roster_management_forbidden" ? 403 :
          error.code === "invalid_application_review" ? 400 : 409).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post<{ Params: { applicationId: string }; Body: { rank_index?: unknown } }>(
    "/guild/roster/applications/:applicationId/approve", async (request, reply) => {
      const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
      if (!identity) return reply.code(401).send({ error: "not_authenticated" });
      if (!validCharacterRecordId(request.params.applicationId) || !validRosterRank(request.body?.rank_index)) {
        return reply.code(400).send({ error: "invalid_application_approval" });
      }
      try {
        const application = await pendingRosterApplications(identity.identityId);
        const pending = application.applications.find(
          (row: { application_id: string }) => row.application_id === request.params.applicationId,
        );
        if (!pending) return reply.code(409).send({ error: "application_not_pending" });
        await changeManualRosterMember({
          actorIdentityId: identity.identityId,
          characterRecordId: pending.character_record_id,
          action: "add",
          rankIndex: request.body!.rank_index as number,
          applicationId: request.params.applicationId,
        });
        return reply.send({ applicationId: request.params.applicationId, status: "approved" });
      } catch (error) {
        if (error instanceof RosterApplicationError && error.code === "roster_management_forbidden") {
          return reply.code(403).send({ error: error.code });
        }
        if (error instanceof ManualRosterOperationError) {
          const status = error.code === "roster_management_forbidden" ? 403 :
            error.code === "unknown_guild_rank" ? 404 : 409;
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
