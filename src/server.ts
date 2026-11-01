import cookie from "@fastify/cookie";
import Fastify, { LogController, type FastifyBaseLogger } from "fastify";
import { componentLogger } from "./core/runtime-logger.js";
import { registerApiV1Routes } from "./api-v1-routes.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { databaseReady, isDatabaseUnavailable } from "./core/operations/database-availability.js";
import { registerAuthRoutes } from "./auth.js";
import { registerGlobalGuildCapabilityDefinitions, registerGuildCapabilityPolicyObserver } from "./core/authority/guild-capability-policy.js";
import { registerGuildRoutes } from "./guild-routes.js";
import { installationSecretKey } from "./core/installation-secret.js";
import { installationOperational } from "./core/installation/guild-binding.js";
import { installationBlizzardEncryptedSecretExists } from "./core/installation/blizzard-configuration.js";
import { registerInstallationRoutes } from "./core/installation/routes.js";
import { registerDiscordOAuthRoutes } from "./integrations/discord/oauth-routes.js";
import { registerDiscordInteractionRoutes } from "./integrations/discord/interaction-routes.js";
import { loadDiscordInteractionPublicKey } from "./integrations/discord/interaction-key.js";
import { registerApplicationEmissionConsumers } from "./emissions/consumers.js";
import { startEmissionRecovery } from "./emissions/recovery.js";
import { startGuildRefreshScheduler } from "./guild-refresh-scheduler.js";
import { registerInstalledActivityPlugins, retryActivityPluginPersistence } from "./activity-plugins.js";
import { loadAssetRegistry, registerAssetRoutes } from "./web/assets.js";
import { registerAdminPage } from "./web/pages/admin.js";
import { registerDiscordAdminPage } from "./web/pages/discord-admin.js";
import { registerOperationsAdminPage } from "./web/pages/operations.js";
import { registerCalendarPage } from "./web/pages/calendar.js";
import { registerActivitiesPage } from "./web/pages/activities.js";
import { registerArticlesPage } from "./web/pages/articles.js";
import { registerActivityBoundaryRoutes } from "./web/pages/activity-boundary.js";
import { registerHomePage } from "./web/pages/home.js";
import { registerMePage } from "./web/pages/me.js";
import { registerMyParticipationPage } from "./web/pages/my-participation.js";
import { registerSiteInformationPages } from "./web/pages/site-information.js";
import { registerSetupPage } from "./web/pages/setup.js";
import { registerRosterMembersPage } from "./web/pages/roster-members.js";

// Database-dependent secret inspection runs after readiness.

const apiLogger: FastifyBaseLogger = componentLogger("api");
const app = Fastify({ loggerInstance: apiLogger, logController: new LogController({ disableRequestLogging: true }) });
await app.register(cookie);

let applicationReady = false;

const maintenanceHtml = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Service unavailable</title></head><body><main><h1>Service temporarily unavailable.</h1><p>Please contact your administrator.</p></main></body></html>";
function sendMaintenance(request: { url: string; method: string }, reply: { code: (status: number) => any; header: (name: string, value: string) => any; type: (value: string) => any; send: (body: unknown) => any }) {
  reply.code(503).header("Cache-Control", "no-store").header("Retry-After", "10");
  if (request.url.startsWith("/api/") || request.method !== "GET") return reply.send({ error: "service_temporarily_unavailable" });
  return reply.type("text/html; charset=utf-8").send(maintenanceHtml);
}

app.addHook("onRequest", async (request, reply) => {
  if (request.url.split("?")[0] === "/health") return;
  if (!await databaseReady()) {
    applicationReady = false;
    return sendMaintenance(request, reply);
  }
  if (!applicationReady) return sendMaintenance(request, reply);
});
app.setErrorHandler((error, request, reply) => {
  if (isDatabaseUnavailable(error)) {
    applicationReady = false;
    request.log.error({ err: error }, "Database unavailable during request");
    return sendMaintenance(request, reply);
  }
  request.log.error({ err: error }, "Request failed");
  return reply.code(typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500).send({ error: "internal_server_error" });
});

registerGlobalGuildCapabilityDefinitions();

const webAssets = await loadAssetRegistry();
await registerInstalledActivityPlugins(app, webAssets, app.log);

registerApplicationEmissionConsumers();
registerGuildCapabilityPolicyObserver();

app.get("/health", async (_request, reply) => {
  if (!await databaseReady()) {
    applicationReady = false;
    return reply.code(503).send({ status: "unavailable" });
  }
  if (!applicationReady) return reply.code(503).send({ status: "unavailable" });
  return { status: "ok" };
});

await registerAssetRoutes(app, webAssets);
await registerHomePage(app, webAssets);
await registerMePage(app, webAssets);
await registerMyParticipationPage(app, webAssets);
await registerSiteInformationPages(app, webAssets);
await registerCalendarPage(app, webAssets);
await registerActivitiesPage(app, webAssets);
await registerArticlesPage(app, webAssets);
await registerActivityBoundaryRoutes(app, webAssets);
app.get("/events", async (_request, reply) => reply.redirect("/activities"));
app.get<{ Params: { "*": string } }>("/events/*", async (request, reply) => reply.redirect(`/activities/${request.params["*"]}`));
await registerAdminPage(app, webAssets);
await registerRosterMembersPage(app, webAssets);
await registerDiscordAdminPage(app, webAssets);
await registerDiscordOAuthRoutes(app);
// Interaction key loads during readiness inspection.
await registerDiscordInteractionRoutes(app);
await registerOperationsAdminPage(app, webAssets);
await registerAuthRoutes(app, webAssets);

let stopGuildRefreshScheduler: (() => void) | null = null;
let stopEmissionRecovery: (() => void) | null = null;
const startOperationalBackgroundWork = (): void => {
  if (stopEmissionRecovery || stopGuildRefreshScheduler) return;
  stopEmissionRecovery = startEmissionRecovery(app.log, databaseReady);
  stopGuildRefreshScheduler = startGuildRefreshScheduler(app.log, databaseReady);
};

await registerSetupPage(app, webAssets);
await registerInstallationRoutes(app, { onOperational: startOperationalBackgroundWork });
await registerGuildRoutes(app);
await registerApiV1Routes(app);

let readinessTimer: NodeJS.Timeout | null = null;
const shutdown = async (): Promise<void> => {
  if (readinessTimer) clearInterval(readinessTimer);
  stopEmissionRecovery?.();
  stopGuildRefreshScheduler?.();
  await app.close();
  await pool.end();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: "0.0.0.0", port: config.port });

let inspectingReadiness = false;
async function inspectReadiness(): Promise<void> {
  if (inspectingReadiness) return;
  inspectingReadiness = true;
  try {
    if (!await databaseReady()) {
      applicationReady = false;
      return;
    }
    await retryActivityPluginPersistence(app.log);
    const encryptedDataExists = await installationBlizzardEncryptedSecretExists();
    installationSecretKey({ encryptedDataExists });
    await loadDiscordInteractionPublicKey();
    if (await installationOperational()) startOperationalBackgroundWork();
    applicationReady = true;
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      applicationReady = false;
      app.log.warn({ err: error }, "Database connection lost during readiness inspection; retrying");
      return;
    }
    applicationReady = false;
    app.log.fatal({ err: error }, "Installation readiness failed; API cannot safely continue");
    process.exitCode = 1;
    if (readinessTimer) clearInterval(readinessTimer);
    await shutdown();
  } finally {
    inspectingReadiness = false;
  }
}
await inspectReadiness();
readinessTimer = setInterval(() => void inspectReadiness(), 10_000);
readinessTimer.unref();
