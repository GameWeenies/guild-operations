import { guildRefreshStatus } from "../../core/guild/guild-refresh-status.js";
import type { FastifyInstance } from "fastify";
import { authenticatedIdentity, SESSION_COOKIE_NAME } from "../../auth.js";
import { effectiveGuildAuthority } from "../../core/authority/guild-permissions.js";
import { setGuildRankDisplayName } from "../../core/guild/guild-ranks.js";
import {
  canAdministerGuildPermissions,
  guildCapabilityPoliciesForActor,
  setGuildCapabilityPermittedRanks,
  type GuildCapabilityPolicySet,
} from "../../core/authority/guild-capability-policy.js";
import {
  GUILD_REFRESH_MINIMUM_INTERVAL_SECONDS,
  type GuildRefreshSchedule,
} from "../../core/guild/guild-refresh-schedule.js";
import {
  DISCORD_CONFIGURE_CAPABILITY,
  GUILD_PRESENTATION_CONFIGURE_CAPABILITY,
  MODULES_CONFIGURE_CAPABILITY,
  THEME_CONFIGURE_CAPABILITY,
  identityHasGuildCapability,
  identityHasGuildCapabilityOrOperator,
} from "../../core/authority/guild-permissions.js";
import { activityCapabilityDeclarationState, activityRegistrationStates, type ActivityRegistrationState } from "../../core/activity/registry.js";
import { knownActivityPlugins } from "../../core/activity/plugin-control.js";
import { setActivityPluginEnabled } from "../../core/activity/plugin-enablement.js";
import { hasDevelopmentGuildMasterAuthority } from "../../core/authority/operator-authority.js";
import { GUILD_THEMES, guildTheme, isGuildThemeKey, setGuildTheme, type GuildThemeKey } from "../../core/presentation/guild-theme.js";
import { guildPresentation, parseGuildPresentationUrl, setGuildPresentationDestinations, setGuildSettingsLocationAcknowledged, type GuildPresentation } from "../../core/presentation/guild-presentation.js";
import { guildHomepage, parseGuildHomepage, setGuildHomepage, type GuildHomepage, type GuildHomepagePrimitive } from "../../core/presentation/guild-homepage.js";
import type { AssetRegistry } from "../assets.js";
import { renderAdminSectionStack, renderGuildSettingsHeader, renderPage, renderPanel, renderSettingsWorkspaceNavigation } from "../render.js";
import { viewerForRequest } from "../viewer.js";
import { renderDiscordContextSetting } from "./discord-admin.js";
import { publishOperationalRecord } from "../../operational-inspection.js";
import { publishInspectionBestEffort } from "../../core/operational-inspection/best-effort.js";
import { componentLogger } from "../../core/runtime-logger.js";

const inspectionLog = componentLogger("activity.enablement.inspection");

function htmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function administrationSection(sectionId: string, headingId: string, heading: string, content: string): string {
  return `<section id="${sectionId}" class="admin-section" aria-labelledby="${headingId}"><h2 id="${headingId}">${heading}</h2>${content}</section>`;
}

async function renderActivityAdministration(canConfigureModules: boolean, publication: Record<string, string> = {}): Promise<string> {
  const [states, fingerprints] = await Promise.all([activityRegistrationStates(), knownActivityPlugins()]);
  const labels = new Map(fingerprints.map((plugin) => [plugin.kind, plugin.label]));
  const cards = states.map((state: ActivityRegistrationState) => {
    const toggleDisabled = canConfigureModules && state.available && state.status !== "failed" ? "" : " disabled";
    return renderPanel(`<div class="module-lifecycle-header"><div class="module-lifecycle-copy"><div class="module-lifecycle-heading"><h3>${htmlText(labels.get(state.kind) ?? state.kind)}</h3><span class="module-lifecycle-availability">${htmlText(state.status)}</span></div></div><label class="switch module-lifecycle-toggle"><input type="checkbox" data-activity-enabled${state.enabled === false ? "" : " checked"}${toggleDisabled}><span class="switch-control" aria-hidden="true"></span><span data-activity-switch-label>${state.enabled === false ? "Off" : "On"}</span></label></div>${publication[state.kind] ? `<div class="module-lifecycle-publication"><h4>Discord publication</h4>${publication[state.kind]}</div>` : ""}<div class="module-lifecycle-actions"><button type="button" class="button-primary" data-activity-save disabled>Save changes</button><a class="module-lifecycle-configure" href="/admin/roster/ranks">Manage permissions →</a></div><p class="module-lifecycle-feedback" data-activity-feedback role="status" aria-live="polite"></p>`, { element: "article", className: "module-lifecycle-card", attributes: { "data-activity-key": state.kind } });
  });
  return `<section class="packaged-capability-group"><div class="module-lifecycle-list">${cards.join("\n")}</div></section>`;
}

export function renderGuildRefreshSchedule(schedule: GuildRefreshSchedule): string {
  const nextAutomaticRefresh = schedule.nextDueAtUnix === null ? "Disabled" : `<time data-unix-time="${schedule.nextDueAtUnix}">${schedule.nextDueAtUnix}</time>`;
  return `<form class="guild-refresh-schedule" data-guild-refresh-schedule-form><div class="guild-refresh-schedule-heading"><div><h3>Automatic guild refresh</h3><p>Reconcile current guild membership and rank authority from Blizzard on a repeating cadence.</p></div><label class="switch guild-refresh-toggle"><input type="checkbox" data-guild-refresh-schedule-enabled${schedule.enabled ? " checked" : ""}><span class="switch-control" aria-hidden="true"></span><span data-switch-label>${schedule.enabled ? "On" : "Off"}</span></label></div><div class="guild-refresh-schedule-controls"><label><span>Every</span><input type="number" min="${GUILD_REFRESH_MINIMUM_INTERVAL_SECONDS}" step="1" value="${schedule.intervalSeconds}" inputmode="numeric" data-guild-refresh-schedule-interval><span>seconds</span></label><button type="submit" class="button-primary" data-guild-refresh-schedule-save>Save</button></div><div class="guild-refresh-schedule-next"><span>Next automatic refresh</span><strong data-guild-refresh-schedule-next>${nextAutomaticRefresh}</strong></div><p class="guild-refresh-schedule-feedback" data-guild-refresh-schedule-feedback role="status" aria-live="polite"></p></form>`;
}

export function renderGuildRefreshOperation(status: Awaited<ReturnType<typeof guildRefreshStatus>>, canRefresh: boolean): string {
  const memberCount = status ? status.currentMemberCount.toLocaleString("en-US") : "—";
  const lastReconciled = status ? `<time data-unix-time="${status.lastReconciledAtUnix}">${status.lastReconciledAtUnix}</time>` : "Not yet observed";
  return `<div class="guild-refresh-admin" data-guild-refresh-admin><div class="guild-refresh-admin-heading"><div><h3>Manual guild refresh</h3><p>Reconcile current guild membership and rank authority from Blizzard now.</p></div><button type="button" class="guild-refresh-button button-primary" data-guild-refresh-button${canRefresh ? "" : " disabled"}>Refresh now</button></div><div class="guild-refresh-status"><div class="guild-refresh-stat"><strong>${memberCount}</strong><span>current members</span></div><div class="guild-refresh-stat"><span>Last reconciled</span><strong>${lastReconciled}</strong></div></div><p class="guild-refresh-feedback" data-guild-refresh-feedback role="status" aria-live="polite"></p></div>`;
}

function renderThemeSettings(theme: GuildThemeKey): string {
  const options = GUILD_THEMES.map((candidate) => `<option value="${candidate.key}"${candidate.key === theme ? " selected" : ""}>${htmlText(candidate.label)}</option>`).join("");
  return renderPanel(`<div><h3>Theme</h3><p>Choose the color palette used throughout Guild Operations for this guild.</p></div><div class="theme-settings-controls"><label><span>Palette</span><select data-theme-select>${options}</select></label><button type="submit" class="button-primary" data-theme-save>Save</button></div><p class="theme-settings-feedback" data-theme-feedback role="status" aria-live="polite"></p>`, { element: "form", className: "theme-settings", attributes: { "data-theme-settings-form": true } });
}

function renderGuildPresentationSettings(presentation: GuildPresentation): string {
  return renderPanel(`<div><h3>Guild links</h3><p>Optional third-party destinations presented for this guild. Blizzard identity and the WoW Armory destination are derived from observed guild truth.</p></div><div class="theme-settings-controls"><label><span>Raider.IO URL</span><input type="url" value="${htmlText(presentation.raiderIoUrl ?? "")}" placeholder="https://" data-raider-io-url></label><label><span>Warcraft Logs URL</span><input type="url" value="${htmlText(presentation.warcraftLogsUrl ?? "")}" placeholder="https://" data-warcraft-logs-url></label><button type="submit" class="button-primary" data-guild-presentation-save>Save</button></div><p class="theme-settings-feedback" data-guild-presentation-feedback role="status" aria-live="polite"></p>`, { element: "form", className: "guild-presentation-settings", attributes: { "data-guild-presentation-form": true } });
}

function renderHomepagePrimitiveEditor(primitive: GuildHomepagePrimitive): string {
  const controls = `<div class="homepage-section-controls"><button type="button" class="button-secondary" data-homepage-move-up aria-label="Move piece up">↑</button><button type="button" class="button-secondary" data-homepage-move-down aria-label="Move piece down">↓</button><button type="button" class="button-secondary" data-homepage-remove>Remove</button></div>`;
  if (primitive.kind === "articles") {
    return renderPanel(`<div class="homepage-section-editor-heading"><strong>Articles</strong>${controls}</div><div class="homepage-section-fields"><label><span>Recent Articles</span><input type="number" min="1" max="10" value="${primitive.count}" data-homepage-article-count></label><p>Guild Operations shows the most recently published Articles here.</p></div>`, { element: "article", className: "homepage-section-editor", attributes: { "data-homepage-primitive": true, "data-kind": "articles" } });
  }
  if (primitive.kind === "card") {
    const texts = primitive.texts.map((text, index) => `<div class="homepage-card-text"><label><span>Text ${index + 1}</span><textarea rows="3" data-homepage-card-text>${htmlText(text)}</textarea></label>${index === 0 ? "" : '<button type="button" class="homepage-card-text-remove" data-homepage-remove-text aria-label="Remove this text">×</button>'}</div>`).join("");
    return renderPanel(`<div class="homepage-section-editor-heading"><strong>Card</strong>${controls}</div><div class="homepage-section-fields"><label><span>Title</span><input type="text" value="${htmlText(primitive.heading)}" data-homepage-heading></label><div class="homepage-card-texts" data-homepage-card-texts>${texts}</div><div><button type="button" class="button-secondary homepage-add-text" data-homepage-add-text>+ Add text</button></div></div>`, { element: "article", className: "homepage-section-editor", attributes: { "data-homepage-primitive": true, "data-kind": "card" } });
  }
  return renderPanel(`<div class="homepage-section-editor-heading"><strong>Statement</strong>${controls}</div><div class="homepage-section-fields"><label><span>Kicker <small>optional</small></span><input type="text" value="${htmlText(primitive.kicker ?? "")}" data-homepage-kicker></label><label><span>Heading <small>optional</small></span><input type="text" value="${htmlText(primitive.heading ?? "")}" data-homepage-heading></label><label><span>Text</span><textarea rows="3" data-homepage-body>${htmlText(primitive.body)}</textarea></label></div>`, { element: "article", className: "homepage-section-editor", attributes: { "data-homepage-primitive": true, "data-kind": "statement" } });
}

function renderHomepageSettings(homepage: GuildHomepage): string {
  const primitives = homepage.primitives.map(renderHomepagePrimitiveEditor).join("");
  return `<form class="homepage-settings" data-homepage-form>${renderPanel(`<div><h3>Introduction</h3><p>The guild name comes from Blizzard. Add the small amount of context that should greet people beneath it.</p></div><div class="homepage-section-fields"><label><span>Introduction</span><textarea rows="2" placeholder="A World of Warcraft guild." data-homepage-lede>${htmlText(homepage.lede ?? "")}</textarea></label><label><span>Supporting line <small>optional</small></span><textarea rows="2" data-homepage-supporting-text>${htmlText(homepage.supportingText ?? "")}</textarea></label></div>`, { className: "homepage-introduction-settings" })}<div class="homepage-settings-heading"><div><h3>Homepage pieces</h3><p>Add cards, statements, and the Articles feed in the order they should appear. Cards contain a title and one or more related text blocks. Guild Operations arranges them for the available screen.</p></div></div><div class="homepage-sections" data-homepage-primitives>${primitives}</div><div class="homepage-add-actions"><button type="button" class="button-secondary" data-homepage-add-card>Add card</button><button type="button" class="button-secondary" data-homepage-add-statement>Add statement</button>${homepage.primitives.some((primitive) => primitive.kind === "articles") ? "" : '<button type="button" class="button-secondary" data-homepage-add-articles>Add Articles</button>'}</div><div class="homepage-settings-actions"><a class="button-secondary" href="/" target="_blank" rel="noopener noreferrer">View homepage ↗</a><button type="submit" class="button-primary" data-homepage-save>Save homepage</button></div><p class="theme-settings-feedback" data-homepage-feedback role="status" aria-live="polite"></p></form>`;
}

function renderAdministrationOrientation(presentation: GuildPresentation, canConfigure: boolean): string {
  const checked = presentation.guildSettingsLocationAcknowledged ? " checked" : "";
  const disabled = canConfigure ? "" : " disabled";
  return `<section class="admin-orientation" aria-labelledby="admin-orientation-heading"><div class="admin-orientation-copy"><h2 id="admin-orientation-heading">Guild administration</h2><p>You are in your guild's administrative area. What you can view or change here depends on your permissions.</p></div><label class="admin-orientation-acknowledgement"><input type="checkbox" data-guild-settings-location-acknowledged${checked}${disabled}><span>I know where to find Guild Settings</span></label><p class="admin-orientation-feedback" data-guild-settings-orientation-feedback role="status" aria-live="polite"></p></section>`;
}

function renderPermissionPolicies(policies: GuildCapabilityPolicySet, canRename: boolean): string {
  const ranks = policies.ranks.filter((rank) => rank.active);
  const sections = ranks.map((rank) => {
    const groups = new Map<string, { label: string; capabilities: GuildCapabilityPolicySet["capabilities"] }>();
    for (const capability of policies.capabilities) {
      const group = groups.get(capability.namespace) ?? { label: capability.namespaceLabel, capabilities: [] };
      group.capabilities.push(capability);
      groups.set(capability.namespace, group);
    }
    const nameEditor = canRename
      ? `<div class="rank-name-form" data-rank-name-form data-rank-index="${rank.rankIndex}"><label>Display name <input name="displayName" maxlength="80" required value="${htmlText(rank.displayName)}"></label></div>`
      : "";
    const capabilities = [...groups.values()].map((group) => `<section class="permission-namespace"><h3>${htmlText(group.label)}</h3><div class="permission-capabilities">${group.capabilities.map((capability) => {
      const enabled = rank.rankIndex === 0 || capability.permittedRanks.includes(rank.rankIndex);
      return `<label class="rank-capability-row"><input type="checkbox" data-rank-capability="${htmlText(capability.key)}" data-rank-index="${rank.rankIndex}" data-permitted-ranks="${htmlText(capability.permittedRanks.join(","))}"${enabled ? " checked" : ""}${rank.rankIndex === 0 ? " disabled" : ""}><span><strong>${htmlText(capability.label)}</strong>${capability.description ? `<small>${htmlText(capability.description)}</small>` : ""}</span><span role="status" data-capability-status></span></label>`;
    }).join("")}</div></section>`).join("");
    return `<details id="rank-${rank.rankIndex}" class="rank-workspace" data-rank-workspace><summary class="rank-workspace-heading"><strong data-rank-heading>${htmlText(rank.displayName)}</strong><span class="rank-coordinate">${rank.rankIndex === 0 ? "Guild Master · highest Blizzard rank · Rank 0" : `Blizzard Rank ${rank.rankIndex}`}</span></summary><div class="rank-workspace-content"><div class="rank-editor-section">${nameEditor}</div><div class="rank-editor-section"><details class="rank-capability-details"><summary>Capabilities ${rank.rankIndex === 0 ? "· inherent authority" : ""}</summary><p>${rank.rankIndex === 0 ? "Guild Master has inherent authority; grants cannot be removed here." : "Changes are saved with the rest of this rank."}</p>${capabilities}</details></div><div class="rank-editor-section" data-discord-role-slot="${rank.rankIndex}"></div><div class="rank-editor-actions"><button type="button" class="button-primary" data-rank-save disabled>Save changes</button><span role="status" data-rank-save-status aria-live="polite"></span></div></div></details>`;
  }).join("");
  return `<div class="rank-workspaces">${sections}</div>`;
}

const appearanceWorkspaces = [{ label: "Appearance", href: "/admin/appearance" }, { label: "Homepage", href: "/admin/appearance/homepage" }] as const;
const rosterWorkspaces = [{ label: "Members", href: "/admin/roster/members" }, { label: "Ranks", href: "/admin/roster/ranks" }, { label: "Synchronization", href: "/admin/roster/synchronization" }] as const;

export async function registerAdminPage(app: FastifyInstance, assets: AssetRegistry): Promise<void> {
  app.get("/admin", async (_request, reply) => reply.redirect("/admin/general"));

  app.get("/admin/general", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    const [viewer, identity] = await Promise.all([viewerForRequest(sessionToken), authenticatedIdentity(sessionToken)]);
    if (!identity) return reply.code(401).send("Authentication is required.");

    const [canConfigureGuildPresentation, canConfigureDiscord] = await Promise.all([
      identityHasGuildCapability(identity.identityId, GUILD_PRESENTATION_CONFIGURE_CAPABILITY),
      identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY),
    ]);
    const presentation = await guildPresentation();

    const orientation = renderAdministrationOrientation(presentation, canConfigureGuildPresentation);
    const articleSettings = canConfigureDiscord ? administrationSection("article-publication", "article-publication-heading", "Article publication", renderPanel(await renderDiscordContextSetting("article", request.log))) : "";
    const content = `${orientation}${renderAdminSectionStack(articleSettings)}`;

    const html = renderPage(assets, { pathname: "/admin/general", title: `General Settings · ${viewer.guildPresentation.guildName} Guild Operations`, description: "Inspect and configure Guild Operations.", viewer, stylesheets: ["admin.css", "discord-admin.css"], scripts: ["admin.js", "operations.js"], header: renderGuildSettingsHeader("General", "Inspect and manage guild-wide configuration."), body: `${content}` });
    return reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(html);
  });

  for (const workspace of ["appearance", "homepage"] as const) {
    const pathname = workspace === "appearance" ? "/admin/appearance" : "/admin/appearance/homepage";
    app.get(pathname, async (request, reply) => {
      const sessionToken = request.cookies[SESSION_COOKIE_NAME];
      const [viewer, identity] = await Promise.all([viewerForRequest(sessionToken), authenticatedIdentity(sessionToken)]);
      if (!identity) return reply.code(401).send("Authentication is required.");
      const navigation = renderSettingsWorkspaceNavigation("Appearance", appearanceWorkspaces, pathname);
      if (workspace === "homepage") {
        const [canConfigureGuildPresentation, homepage] = await Promise.all([
          identityHasGuildCapability(identity.identityId, GUILD_PRESENTATION_CONFIGURE_CAPABILITY), guildHomepage(),
        ]);
        const homepageSettings = canConfigureGuildPresentation
          ? renderHomepageSettings(homepage)
          : renderHomepageSettings(homepage).replaceAll("<input ", "<input disabled ").replaceAll("<textarea ", "<textarea disabled ").replaceAll("<select ", "<select disabled ").replaceAll("<button ", "<button disabled ");
        const homepageSection = administrationSection("homepage-presentation", "homepage-presentation-heading", "Homepage", homepageSettings);
        const html = renderPage(assets, { pathname, title: `Homepage Settings · ${viewer.guildPresentation.guildName} Guild Operations`, description: "Configure the guild homepage.", viewer, stylesheets: ["admin.css"], scripts: ["homepage-admin.js"], header: `${renderGuildSettingsHeader("Appearance", "Configure how your guild is presented in Guild Operations.")}${navigation}`, body: renderAdminSectionStack(homepageSection) });
        return reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(html);
      }
      const [canConfigureTheme, canConfigureGuildPresentation, theme, presentation] = await Promise.all([
        identityHasGuildCapability(identity.identityId, THEME_CONFIGURE_CAPABILITY),
        identityHasGuildCapability(identity.identityId, GUILD_PRESENTATION_CONFIGURE_CAPABILITY),
        guildTheme(), guildPresentation(),
      ]);
      const themeSettings = administrationSection("appearance", "appearance-heading", "Appearance", renderThemeSettings(theme).replaceAll("<select data-theme-select>", `<select data-theme-select${canConfigureTheme ? "" : " disabled"}>`).replaceAll("<button type=\"submit\" class=\"button-primary\" data-theme-save>", `<button type="submit" class="button-primary" data-theme-save${canConfigureTheme ? "" : " disabled"}>`));
      const presentationSettings = administrationSection("guild-presentation", "guild-presentation-heading", "Guild links", canConfigureGuildPresentation ? renderGuildPresentationSettings(presentation) : renderGuildPresentationSettings(presentation).replaceAll("<input ", "<input disabled ").replaceAll("<button type=\"submit\"", "<button disabled type=\"submit\""));
      const html = renderPage(assets, { pathname, title: `Appearance Settings · ${viewer.guildPresentation.guildName} Guild Operations`, description: "Configure the guild appearance.", viewer, stylesheets: ["admin.css"], scripts: ["admin.js"], header: `${renderGuildSettingsHeader("Appearance", "Configure how your guild is presented in Guild Operations.")}${navigation}`, body: renderAdminSectionStack(themeSettings, presentationSettings) });
      return reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(html);
    });
  }

  app.get("/admin/homepage", async (_request, reply) => reply.redirect("/admin/appearance/homepage"));

  app.get("/admin/modules", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    const [viewer, identity] = await Promise.all([viewerForRequest(sessionToken), authenticatedIdentity(sessionToken)]);
    if (!identity) return reply.code(401).send("Authentication is required.");
    const canConfigureModules = await identityHasGuildCapabilityOrOperator(identity.identityId, MODULES_CONFIGURE_CAPABILITY);
    const canConfigureDiscord = await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY);
    const publication: Record<string, string> = canConfigureDiscord ? {
      raid: await renderDiscordContextSetting("raid", request.log),
      raffle: await renderDiscordContextSetting("raffle", request.log),
    } : {};
    const lifecycle = await renderActivityAdministration(canConfigureModules, publication);
    const content = administrationSection("modules", "modules-heading", "Activities", lifecycle);
    const html = renderPage(assets, { pathname: "/admin/modules", title: `Plugin Settings · ${viewer.guildPresentation.guildName} Guild Operations`, description: "Manage optional capabilities available to this guild.", viewer, stylesheets: ["admin.css", "admin-modules.css", "discord-admin.css"], scripts: ["admin-modules.js"], header: renderGuildSettingsHeader("Plugins", "Manage the optional capabilities available to your guild."), body: renderAdminSectionStack(content) });
    return reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(html);
  });

  app.put("/admin/activities/:activityKind", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapabilityOrOperator(identity.identityId, MODULES_CONFIGURE_CAPABILITY)) return reply.code(403).send({ error: "module_configuration_not_authorized" });
    const params = request.params as { activityKind?: unknown }; const body = (request.body ?? {}) as { enabled?: unknown };
    if (typeof params.activityKind !== "string" || typeof body.enabled !== "boolean") return reply.code(400).send({ error: "invalid_activity_configuration" });
    const state = (await activityRegistrationStates()).find((candidate) => candidate.kind === params.activityKind);
    if (!state) return reply.code(404).send({ error: "unknown_activity" });
    if (!state.available || state.status === "failed") return reply.code(409).send({ error: "activity_declaration_not_authoritative" });
    await setActivityPluginEnabled(params.activityKind, body.enabled);
    await publishInspectionBestEffort(() => publishOperationalRecord({
      source: "activity",
      operation: "enablement",
      kind: "result",
      result: "success",
      actorIdentityId: identity.identityId,
      summary: `Activity plugin ${params.activityKind} was ${body.enabled ? "enabled" : "disabled"}.`,
      details: { activityKind: params.activityKind, enabled: body.enabled },
    }),
    (error) => inspectionLog.error({ err: error, activityKind: params.activityKind }, "Activity enablement inspection publication failed"),
    () => {});

    return reply.send({ activityKind: params.activityKind, enabled: body.enabled });
  });


  app.put("/admin/general/theme", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, THEME_CONFIGURE_CAPABILITY)) return reply.code(403).send({ error: "theme_configuration_not_authorized" });
    const body = (request.body ?? {}) as { theme?: unknown };
    if (typeof body.theme !== "string" || !isGuildThemeKey(body.theme)) return reply.code(400).send({ error: "unknown_theme" });
    return reply.send({ theme: await setGuildTheme(body.theme) });
  });

  app.put("/admin/general/orientation", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, GUILD_PRESENTATION_CONFIGURE_CAPABILITY)) return reply.code(403).send({ error: "guild_presentation_configuration_not_authorized" });
    const body = (request.body ?? {}) as { acknowledged?: unknown };
    if (typeof body.acknowledged !== "boolean") return reply.code(400).send({ error: "acknowledged_must_be_boolean" });
    return reply.send({ acknowledged: await setGuildSettingsLocationAcknowledged(body.acknowledged) });
  });

  app.put("/admin/general/presentation", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, GUILD_PRESENTATION_CONFIGURE_CAPABILITY)) return reply.code(403).send({ error: "guild_presentation_configuration_not_authorized" });
    const body = (request.body ?? {}) as { raiderIoUrl?: unknown; warcraftLogsUrl?: unknown };
    const raiderIoUrl = parseGuildPresentationUrl(body.raiderIoUrl ?? null);
    const warcraftLogsUrl = parseGuildPresentationUrl(body.warcraftLogsUrl ?? null);
    if (raiderIoUrl === undefined || warcraftLogsUrl === undefined) return reply.code(400).send({ error: "presentation_urls_must_use_http_or_https" });
    return reply.send({ presentation: await setGuildPresentationDestinations({ raiderIoUrl, warcraftLogsUrl }) });
  });

  app.put("/admin/homepage", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, GUILD_PRESENTATION_CONFIGURE_CAPABILITY)) return reply.code(403).send({ error: "guild_presentation_configuration_not_authorized" });
    const homepage = parseGuildHomepage(request.body);
    if (!homepage) return reply.code(400).send({ error: "invalid_homepage_presentation" });
    return reply.send({ homepage: await setGuildHomepage(homepage) });
  });

  app.get("/admin/permissions", async (_request, reply) => reply.redirect("/admin/roster/ranks"));
  app.get("/roster/ranks", async (_request, reply) => reply.redirect("/admin/roster/ranks"));

  app.get("/admin/roster/ranks", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    const [viewer, identity] = await Promise.all([viewerForRequest(sessionToken), authenticatedIdentity(sessionToken)]);
    const authorized = identity ? await canAdministerGuildPermissions(identity.identityId) : false;
    const policies = authorized && identity ? await guildCapabilityPoliciesForActor(identity.identityId) : null;
    const canConfigureDiscord = identity ? await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY) : false;
    const discordRoleSettings = canConfigureDiscord ? `<section class="admin-section"><h2>Discord role mapping</h2>${renderPanel(await renderDiscordContextSetting("roles", request.log))}</section>` : "";
    const developmentAuthority = identity ? hasDevelopmentGuildMasterAuthority(identity.identityId) : false;
    const canRename = identity ? (developmentAuthority || (await effectiveGuildAuthority(identity.identityId))?.rankIndex === 0) : false;
    const content = authorized && policies ? `<section class="permission-administration" aria-labelledby="permission-heading"><div class="permission-intro"><h2 id="permission-heading">Guild ranks</h2><p>Start with a guild rank to review its display name, capabilities, and integration relationships. Lower rank numbers mean higher Guild Operations authority; Rank 0 is Guild Master.</p>${developmentAuthority ? `<p class="permission-operator-notice"><strong>Development authority override active.</strong> This access is independent of your current guild rank.</p>` : ""}</div>${renderPermissionPolicies(policies, canRename)}</section>` : `<section class="admin-unavailable" aria-labelledby="admin-unavailable-heading"><h2 id="admin-unavailable-heading">Permission administration is not available for this account.</h2></section>`;
    const html = renderPage(assets, { pathname: "/admin/roster/ranks", title: `Roster Ranks · ${viewer.guildPresentation.guildName} Guild Operations`, description: "Configure guild rank presentation and capability access.", viewer, stylesheets: ["admin.css", "admin-permissions.css", "discord-admin.css", "roster.css"], scripts: ["admin-permissions.js"], header: `${renderGuildSettingsHeader("Roster", "Manage guild membership and ranks.")}${renderSettingsWorkspaceNavigation("Roster", rosterWorkspaces, "/admin/roster/ranks")}`, body: `${content}${discordRoleSettings}` });
    if (!authorized && !canConfigureDiscord) return reply.code(identity ? 403 : 401).header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(html);
    return reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(html);
  });

  app.put("/admin/ranks/:rankIndex/display-name", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    const authority = await effectiveGuildAuthority(identity.identityId);
    if (authority?.rankIndex !== 0 && !hasDevelopmentGuildMasterAuthority(identity.identityId)) return reply.code(403).send({ error: "guild_master_required" });
    const rankIndex = Number((request.params as { rankIndex?: string }).rankIndex);
    const displayName = (request.body as { displayName?: unknown } | null)?.displayName;
    if (!Number.isSafeInteger(rankIndex) || typeof displayName !== "string") return reply.code(400).send({ error: "invalid_rank_display_name" });
    try {
      return reply.send({ rank: await setGuildRankDisplayName(rankIndex, displayName) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid_rank_display_name";
      return reply.code(message === "unknown_guild_rank" ? 404 : 400).send({ error: message });
    }
  });

  app.put("/admin/permissions/:capability", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    const params = request.params as { capability?: unknown };
    const body = (request.body ?? {}) as { permittedRanks?: unknown };
    if (typeof params.capability !== "string") return reply.code(400).send({ error: "capability_required" });
    if (!Array.isArray(body.permittedRanks) || !body.permittedRanks.every(Number.isInteger)) return reply.code(400).send({ error: "permitted_ranks_must_be_integer_array" });
    try {
      const activityDeclaration = await activityCapabilityDeclarationState(params.capability);
      if (activityDeclaration && !activityDeclaration.authoritative) return reply.code(409).send({ error: "activity_declaration_not_authoritative" });
      const permittedRanks = await setGuildCapabilityPermittedRanks(identity.identityId, params.capability, body.permittedRanks as number[]);
      return reply.send({ capability: params.capability, permittedRanks });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Guild permission could not be updated";
      const statusCode = message.includes("cannot administer") ? 403 : message.includes("Unknown configurable") ? 404 : 400;
      return reply.code(statusCode).send({ error: message });
    }
  });

}
