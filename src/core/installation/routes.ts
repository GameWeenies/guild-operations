import { authorizeRosterRecovery, pendingRosterRecovery, RosterRecoveryError } from "../guild/roster-recovery.js";
import type { FastifyInstance } from "fastify";
import { authenticatedIdentity, SESSION_COOKIE_NAME } from "../../auth.js";
import {
  authorizeInstallationGuildBinding,
  establishPendingInstallationGuildBinding,
  installationGuildBinding,
} from "./guild-binding.js";
import { configuredInstallationGuild } from "./target.js";
import { authorizeInstallationRebind, installationRebindPreview } from "./rebinding.js";

export async function registerInstallationRoutes(
  app: FastifyInstance,
  options: { onOperational?: () => void | Promise<void> } = {},
): Promise<void> {
  app.get("/installation/roster-recovery", async (request, reply) => {
    const pending = await pendingRosterRecovery();
    if (!pending) return reply.code(404).send({ error: "recovery_not_pending" });
    return reply.send({ state: "pending_gm_authorization", requested_at: pending.requested_at });
  });

  app.post("/installation/roster-recovery/authorize", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    const identity = await authenticatedIdentity(token);
    if (!identity || !token) return reply.code(401).send({ error: "not_authenticated" });
    try {
      return reply.send(await authorizeRosterRecovery(identity.identityId, token));
    } catch (error) {
      if (error instanceof RosterRecoveryError) {
        return reply.code(error.code === "verified_installation_gm_required" ||
          error.code === "fresh_verified_gm_control_required" ? 403 : 409).send({ error: error.code });
      }
      throw error;
    }
  });

  app.get("/installation", async (request, reply) => {
    const binding = await installationGuildBinding();
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) {
      return reply.send({
        state: binding?.authorizedAt ? "operational" : binding ? "pending_authorization" : "unbound",
        authenticated: false,
        binding,
      });
    }

    const target = binding ? null : configuredInstallationGuild();
    return reply.send({
      state: binding?.authorizedAt ? "operational" : binding ? "pending_authorization" : "unbound",
      authenticated: true,
      identity_id: identity.identityId,
      binding,
      target,
    });
  });

  app.get("/installation/rebind", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });
    try {
      const preview = await installationRebindPreview();
      if (!preview) return reply.code(404).send({ error: "rebind_not_requested" });
      return reply.send({ state: "pending_rebind", preview });
    } catch (error) {
      request.log.warn({ err: error }, "Installation rebind preview failed");
      return reply.code(409).send({ error: "rebind_target_unavailable" });
    }
  });

  app.post("/installation/rebind/authorize", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });
    try {
      const result = await authorizeInstallationRebind(identity.identityId, request.cookies[SESSION_COOKIE_NAME]!);
      if (result.changed) await options.onOperational?.();
      return reply.send({ state: "operational", ...result });
    } catch (error) {
      request.log.warn({ err: error }, "Installation guild rebind rejected");
      return reply.code(403).send({ error: "rebind_authorization_required" });
    }
  });

  app.post("/installation/guild", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });

    try {
      const binding = await establishPendingInstallationGuildBinding(identity.identityId);
      return reply.code(201).send({ state: "pending_authorization", binding });
    } catch (error) {
      request.log.warn({ err: error }, "Configured installation guild could not be bound");
      return reply.code(409).send({ error: "guild_binding_not_established" });
    }
  });

  app.post("/installation/authorize", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "not_authenticated" });

    try {
      const binding = await authorizeInstallationGuildBinding(identity.identityId);
      await options.onOperational?.();
      return reply.send({ state: "operational", binding });
    } catch (error) {
      request.log.warn({ err: error }, "Installation guild authorization was not established");
      return reply.code(403).send({ error: "installation_authorization_required" });
    }
  });
}
