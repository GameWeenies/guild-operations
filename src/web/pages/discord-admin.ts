import type { FastifyInstance } from "fastify";
import { authenticatedIdentity, SESSION_COOKIE_NAME } from "../../auth.js";
import { DISCORD_CONFIGURE_CAPABILITY, identityHasGuildCapability } from "../../core/authority/guild-permissions.js";
import { installationAbsoluteUrl } from "../../core/installation/public-origin.js";
import {
  discordIntegrationConfiguration,
  pendingDiscordApplicationReplacement,
  reconnectHostDiscordApplication,
  markDiscordApplicationEstablished,
  setDiscordIntegrationEnabled, enableVerifiedDiscordIntegration, establishDiscordGuildBinding,
  setDiscordArticleChannel,
  setDiscordRaidChannel,
  setDiscordRaffleChannel,
} from "../../integrations/discord/configuration.js";
import { cacheDiscordInteractionPublicKey, loadDiscordInteractionPublicKey } from "../../integrations/discord/interaction-key.js";
import { hostDiscordCredentials } from "../../integrations/discord/host-credentials.js";
import { discordBotInstallUrl, currentDiscordApplication, discordBotGuilds, verifyDiscordApplication, discordServerRoles, discordServerMember, discordRoleReadiness, discordChannelPublicationReadiness, discordServerChannels, discordApplicationEmojis, discordApplicationEmojiMarkup, discordChannelMessage, DISCORD_TEXT_CHANNEL, DISCORD_ANNOUNCEMENT_CHANNEL } from "../../integrations/discord/api.js";
import { provisionDiscordPresentationEmojis } from "../../integrations/discord/application-emojis.js";
import { publishOperationalRecord } from "../../operational-inspection.js";
import { discordRankRoleMappings, replaceDiscordRankRoleMappings } from "../../integrations/discord/role-mappings.js";
import { guildRankDefinitions } from "../../core/guild/guild-ranks.js";
import { requireOperationalInstallationGuildBinding } from "../../core/installation/guild-binding.js";
import type { AssetRegistry } from "../assets.js";
import { htmlText, renderActionRow, renderAdminSectionStack, renderFormLayout, renderGuildSettingsHeader, renderPage, renderPanel } from "../render.js";
import { viewerForRequest } from "../viewer.js";

const emojiSetupsInProgress = new Set<string>();

export type DiscordContextSetting = "article" | "raid" | "raffle" | "roles";

/** Presentation only. Mutation endpoints continue to enforce Discord configuration authority. */
export async function renderDiscordContextSetting(kind: DiscordContextSetting, log: { warn: (value: unknown, message: string) => void }): Promise<string> {
  const configuration = await discordIntegrationConfiguration();
  if (kind === "roles") {
    const guildId = (await requireOperationalInstallationGuildBinding()).guildId;
    const [guildRanks, mappings] = await Promise.all([guildRankDefinitions(guildId), discordRankRoleMappings(guildId)]);
    let roleSection = "<p>Enable Discord and establish the server to configure role synchronization.</p>";
    if (configuration?.enabled && configuration.discordGuildId && configuration.botUserId) {
      try {
        const [roles, botMember] = await Promise.all([
          discordServerRoles(configuration.botToken, configuration.discordGuildId),
          discordServerMember(configuration.botToken, configuration.discordGuildId, configuration.botUserId),
        ]);
        if (botMember) {
          const roleReadiness = discordRoleReadiness({
            roles, botRoleIds: botMember.roles, botUserId: configuration.botUserId,
            guildId: configuration.discordGuildId, mappedRoleIds: mappings.map((mapping) => mapping.discordRoleId),
          });
          const options = roles.filter((role) => role.id !== configuration.discordGuildId && !role.managed);
          const fields = guildRanks.map((rank) => {
            const selected = mappings.find((mapping) => mapping.rankIndex === rank.rankIndex)?.discordRoleId ?? "";
            return `<label class="discord-field" data-discord-rank-field="${rank.rankIndex}"><span>Discord role mapping</span>
              <select form="discord-role-mappings-form" name="rank_${rank.rankIndex}"><option value="">Not mapped</option>
              ${options.map((role) => `<option value="${htmlText(role.id)}"${selected === role.id ? " selected" : ""}>${htmlText(role.name)}</option>`).join("")}
              </select></label>`;
          }).join("");
          roleSection = `<p>${mappings.length === 0 ? "No rank roles configured." : roleReadiness.ready ? "Configured role mappings are manageable." : "Role synchronization needs attention."}</p>
            ${roleReadiness.reasons.map((reason) => `<p>${htmlText(reason)}</p>`).join("")}
            <form id="discord-role-mappings-form" method="post" action="/admin/discord/roles"></form>
            <div data-discord-role-fields>${fields}</div>
            <button class="button-primary" type="submit" form="discord-role-mappings-form" data-discord-role-global-save>Save role mappings</button>`;
        } else {
          roleSection = "<p>The bot is not in the bound Discord server.</p>";
        }
      } catch (error) {
        log.warn({ err: error }, "Discord role discovery failed");
        roleSection = "<p>Unable to inspect Discord roles. Check bot authorization.</p>";
      }
    }
    return roleSection;
  }
  if (kind === "article") {
    let articleSection = "<p>Enable Discord and establish the server to select an article publication channel.</p>";
    if (configuration?.enabled && configuration.discordGuildId) {
      try {
        const channels = (await discordServerChannels(configuration.botToken, configuration.discordGuildId))
          .filter((channel) => channel.type === DISCORD_TEXT_CHANNEL || channel.type === DISCORD_ANNOUNCEMENT_CHANNEL);
        const options = channels.map((channel) => `<option value="${htmlText(channel.id)}"${configuration.articleChannelId === channel.id ? " selected" : ""}>${htmlText(channel.name ?? channel.id)}</option>`).join("");
        articleSection = `<p>Publish Guild Operations articles to an optional Discord channel. Articles remain authoritative in Guild Operations.</p>
          <form method="post" action="/admin/discord/articles">
            <label class="discord-field"><span>Article publication channel</span><select name="channel_id"><option value="">Do not publish articles to Discord</option>${options}</select></label>
            <button type="submit" class="button-primary">Save article destination</button>
          </form>`;
      } catch (error) {
        log.warn({ err: error }, "Discord channel discovery failed");
        articleSection = "<p>Unable to inspect Discord channels. Check bot authorization.</p>";
      }
    }
    return articleSection;
  }
  if (kind === "raid") {
    let raidSection = "<p>Enable Discord and establish the server to select a raid publication channel.</p>";
    if (configuration?.enabled && configuration.discordGuildId) {
      try {
        const channels = (await discordServerChannels(configuration.botToken, configuration.discordGuildId))
          .filter((channel) => channel.type === DISCORD_TEXT_CHANNEL || channel.type === DISCORD_ANNOUNCEMENT_CHANNEL);
        const options = channels.map((channel) => `<option value="${htmlText(channel.id)}"${configuration.raidChannelId === channel.id ? " selected" : ""}>${htmlText(channel.name ?? channel.id)}</option>`).join("");
        raidSection = `<form method="post" action="/admin/discord/raids" data-activity-publication-form>
            <label class="discord-field"><span>Raid publication channel</span><select name="channel_id"><option value="">Do not publish raids to Discord</option>${options}</select></label>
            
          </form>`;
      } catch (error) {
        log.warn({ err: error }, "Discord raid channel discovery failed");
        raidSection = "<p>Unable to inspect Discord channels. Check bot authorization.</p>";
      }
    }
    return raidSection;
  }
    let raffleSection = "<p>Enable Discord and establish the server to select a raffle publication channel.</p>";
    if (configuration?.enabled && configuration.discordGuildId) {
      try {
        const channels = (await discordServerChannels(configuration.botToken, configuration.discordGuildId))
          .filter((channel) => channel.type === DISCORD_TEXT_CHANNEL || channel.type === DISCORD_ANNOUNCEMENT_CHANNEL);
        const options = channels.map((channel) => `<option value="${htmlText(channel.id)}"${configuration.raffleChannelId === channel.id ? " selected" : ""}>${htmlText(channel.name ?? channel.id)}</option>`).join("");
        raffleSection = `<form method="post" action="/admin/discord/raffles" data-activity-publication-form>
            <label class="discord-field"><span>Raffle publication channel</span><select name="channel_id"><option value="">Do not publish raffles to Discord</option>${options}</select></label>
            
          </form>`;
      } catch (error) {
        log.warn({ err: error }, "Discord raffle channel discovery failed");
        raffleSection = "<p>Unable to inspect Discord channels. Check bot authorization.</p>";
      }
    }
  return raffleSection;
}

export async function registerDiscordAdminPage(app: FastifyInstance, assets: AssetRegistry): Promise<void> {
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
      const params = new URLSearchParams(typeof body === "string" ? body : body.toString("utf8"));
      done(null, Object.fromEntries(params.entries()));
    });
  }

  app.get("/admin/discord", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    const [identity, viewer] = await Promise.all([authenticatedIdentity(token), viewerForRequest(token)]);
    if (!identity) return reply.code(401).send("Authentication is required.");
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send("Discord configuration is not available for this account.");
    }

    const [configuration, callbackUrl] = await Promise.all([
      discordIntegrationConfiguration(),
      installationAbsoluteUrl("/integrations/discord/oauth/callback"),
    ]);
    const replacement = await pendingDiscordApplicationReplacement();
    const readiness = !configuration
      ? "Not configured"
      : !configuration.applicationVerifiedAt
        ? "Setup required · application not verified"
        : configuration.discordGuildId
        ? configuration.enabled ? "Enabled · server established" : "Configured · disabled"
        : configuration.enabled ? "Enabled · server not established" : "Configured · disabled";

    const confirmServerForm = configuration?.applicationVerifiedAt && !configuration.discordGuildId
      ? '<form method="post" action="/admin/discord/confirm-server"><p>Confirm the Discord server after installing the bot. The bot must belong to exactly one server.</p><button type="submit">Confirm Discord server</button></form>'
      : "";
    const installUrl = (configuration?.applicationVerifiedAt || replacement) && configuration ? discordBotInstallUrl(configuration.applicationId) : null;
    let previewSection = "<p>Enable Discord and establish the server to send an emoji preview.</p>";
    if (configuration?.enabled && configuration.discordGuildId && configuration.applicationVerifiedAt) {
      try {
        const channels = (await discordServerChannels(configuration.botToken, configuration.discordGuildId))
          .filter((channel) => channel.type === DISCORD_TEXT_CHANNEL || channel.type === DISCORD_ANNOUNCEMENT_CHANNEL);
        previewSection = channels.length
          ? `<p>Send one sample raid-style message to a selected channel. This does not configure ongoing publication.</p>
             <form method="post" action="/admin/discord/emoji/preview">
               <label class="discord-field"><span>Preview destination</span>
                 <select name="channel_id" required><option value="">Choose a Discord channel</option>
                   ${channels.map((channel) => `<option value="${htmlText(channel.id)}">${htmlText(channel.name ?? channel.id)}</option>`).join("")}
                 </select></label>
               <button type="submit" class="button-secondary">Send emoji preview</button>
             </form>`
          : "<p>No text channels are available for a preview.</p>";
      } catch (error) {
        request.log.warn({ err: error }, "Discord preview channel discovery failed");
        previewSection = "<p>Unable to inspect Discord channels for the preview.</p>";
      }
    }
    const body = renderAdminSectionStack(`
      <section class="admin-section" aria-labelledby="discord-heading">
        <h2 id="discord-heading">Discord Integration</h2>
        ${renderPanel(`<div><h3>Status</h3><p><strong>${htmlText(readiness)}</strong></p>${configuration?.applicationVerifiedAt ? `<p>Application: ${htmlText(configuration.applicationName ?? configuration.applicationId)}${configuration.botUsername ? ` · Bot: ${htmlText(configuration.botUsername)}` : ""}</p>` : ""}<p>Discord authorizes the application and server; Guild Operations manages their connection.</p></div>
          ${!hostDiscordCredentials() ? '<p role="status">Discord integration is not configured for this installation. Contact your Guild Operations host administrator.</p>' : `<div class="discord-setup-guide">
            <h3>Discord application</h3>
            <p>Credentials are managed by the host administrator.</p>
            <p>OAuth redirect URI:</p>
            <div class="discord-callback"><code>${htmlText(callbackUrl)}</code><button type="button" class="button-secondary" data-copy-discord-callback>Copy</button></div>
            <p>Interactions use the Gateway; leave the Interactions Endpoint URL empty.</p>
            <form method="post" action="/admin/discord">
              ${renderFormLayout(`<div class="discord-enablement-row">
                <div><strong>Integration enabled</strong></div>
                <label class="switch discord-enablement"><input type="checkbox" name="enabled" value="true"${configuration?.enabled ? " checked" : ""}><span class="switch-control" aria-hidden="true"></span><span>${configuration?.enabled ? "On" : "Off"}</span></label>
              </div>`, renderActionRow('<button type="submit" class="button-primary">Save integration settings</button>'))}
            </form>
          </div>`}
          ${confirmServerForm}
          ${replacement ? `<div class="discord-server-install" role="status"><h3>Reconnect Discord application</h3>
            <p>The host administrator changed the Discord application. Existing guild settings are preserved but inactive. Install the new bot in your Discord server, then confirm the application change.</p>
            ${replacement.previousServerId ? `<p>Previous Discord server ID: <code>${htmlText(replacement.previousServerId)}</code></p>` : "<p>No Discord server was previously connected. After confirmation, choose your server using the normal installation flow.</p>"}
            <form method="post" action="/admin/discord/reconnect"><button class="button-primary" type="submit">Verify replacement application</button></form>
            <p>Integration remains disabled until you review and enable it again.</p>
          </div>` : ""}
          ${installUrl && !configuration?.discordGuildId ? `<div class="discord-server-install"><h3>Install in your Discord server</h3><p>Choose the server for this deployment. Guild Operations verifies the bot relationship before binding the server.</p><a class="button-primary" href="${htmlText(installUrl)}" target="_blank" rel="noreferrer">Install in Discord Server</a></div>` : ""}
        `)}
      </section>
      <section class="admin-section"><h2>Discord emojis</h2>${renderPanel(`\n        <p>Set up raid role and WoW specialization icons. Existing icons are reused; unrelated emojis are not changed.</p>
        ${configuration?.applicationVerifiedAt ? `<form data-emoji-setup method="post" action="/admin/discord/emoji/raid-roles">
          <button type="submit" class="button-secondary" data-emoji-submit>Set up Discord icons</button>
          <div data-emoji-results hidden aria-live="polite">
            <p data-emoji-status role="status"></p>
            <progress data-emoji-progress max="1" value="0"></progress>
            <p data-emoji-counts></p>
            <ul data-emoji-failures></ul>
          </div>
        </form>` : "<p>Verify the Discord application first.</p>"}
        <div class="discord-emoji-preview"><h3>Rendering preview</h3>
        ${((request.query as { preview?: string }).preview === "success") ? '<p role="status">Discord emoji preview sent to the selected channel.</p>' : ((request.query as { preview?: string }).preview === "failed") ? '<p role="alert">Unable to send the emoji preview. Check Operations → Logs.</p>' : ""}
        ${previewSection}</div>
      `)}</section>
    `);

    return reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(renderPage(assets, {
      pathname: "/admin/discord",
      title: `Discord Settings · ${viewer.guildPresentation.guildName} Guild Operations`,
      description: "Configure the Discord Integration.",
      viewer,
      stylesheets: ["admin.css", "discord-admin.css"],
      header: renderGuildSettingsHeader("Discord", "Connect Guild Operations to this guild’s Discord application and server."),
      body,
      scripts: ["discord-admin.js"],
    }));
  });

  app.post("/admin/discord/emoji/raid-roles", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send({ error: "discord_configuration_not_authorized" });
    }
    const configuration = await discordIntegrationConfiguration();
    if (!configuration?.applicationVerifiedAt) return reply.code(409).send({ error: "discord_application_not_verified" });
    const expectedBinding = await requireOperationalInstallationGuildBinding();
    if (emojiSetupsInProgress.has(configuration.applicationId)) {
      return reply.code(409).send({ error: "emoji_setup_already_running" });
    }
    emojiSetupsInProgress.add(configuration.applicationId);
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    const send = (event: object) => { if (!reply.raw.destroyed) reply.raw.write(JSON.stringify(event) + "\n"); };
    const safeReason = (reason: string): string => {
      if (reason.startsWith("specialization_icon_http_")) return "Blizzard artwork request failed (" + reason.slice("specialization_icon_http_".length) + ")";
      if (reason === "specialization_icon_unavailable") return "Blizzard artwork unavailable";
      if (reason === "unsupported_specialization_icon_format" || reason === "specialization_icon_too_large") return "Blizzard artwork cannot be uploaded";
      if (reason.startsWith("discord_api_")) return "Discord rejected the icon (" + reason.slice("discord_api_".length) + ")";
      return "Icon upload failed; retry setup";
    };
    try {
      send({ type: "start", message: "Checking existing Discord icons" });
      const result = await provisionDiscordPresentationEmojis({
        assets, botToken: configuration.botToken, applicationId: configuration.applicationId,
        onProgress: (progress) => send({ type: "progress", ...progress, ...(progress.reason ? { reason: safeReason(progress.reason) } : {}) }),
      });
      const complete = result.unavailable.length === 0;
      await publishOperationalRecord({
        source: "discord.application-emoji", operation: "presentation-emoji-setup",
        kind: "result", result: complete ? "success" : "partial",
        actorIdentityId: identity.identityId,
        summary: complete ? "Discord presentation emojis ready" : "Discord presentation emoji setup partially completed",
        details: { applicationId: configuration.applicationId, created: result.created, reused: result.reused, unavailable: result.unavailable, failures: result.failures, emojis: result.emojis.map(({ id, name }) => ({ id, name })) },
      }).catch((error) => request.log.warn({ err: error }, "Unable to record Discord emoji setup result"));
      send({ type: "complete", status: complete ? "success" : "partial", created: result.created, reused: result.reused, failed: result.failures.length, failures: result.failures.map((failure) => ({ name: failure.name, reason: safeReason(failure.reason) })) });
    } catch (error) {
      request.log.error({ err: error }, "Discord emoji setup failed");
      send({ type: "complete", status: "failed", message: "Setup could not finish. Existing icons were preserved; retry to continue." });
    } finally {
      emojiSetupsInProgress.delete(configuration.applicationId);
      reply.raw.end();
    }
  });

  app.post("/admin/discord/emoji/preview", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send({ error: "discord_configuration_not_authorized" });
    }
    const configuration = await discordIntegrationConfiguration();
    if (!configuration?.enabled || !configuration.applicationVerifiedAt || !configuration.discordGuildId) {
      return reply.code(409).send({ error: "discord_integration_not_ready" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const channelId = body.channel_id;
    if (typeof channelId !== "string" || !/^\d+$/.test(channelId)) {
      return reply.code(400).send({ error: "invalid_discord_preview_channel" });
    }
    const channels = await discordServerChannels(configuration.botToken, configuration.discordGuildId);
    if (!channels.some((channel) => channel.id === channelId &&
      (channel.type === DISCORD_TEXT_CHANNEL || channel.type === DISCORD_ANNOUNCEMENT_CHANNEL))) {
      return reply.code(400).send({ error: "invalid_discord_preview_channel" });
    }
    try {
      const available = new Map((await discordApplicationEmojis(configuration.botToken, configuration.applicationId))
        .map((emoji) => [emoji.name, emoji]));
      const icon = (name: string): string => {
        const emoji = available.get(name);
        return emoji ? discordApplicationEmojiMarkup(emoji) : "[icon unavailable]";
      };
      const payload = {
        allowed_mentions: { parse: [] },
        embeds: [{
          title: "Guild Operations · Raid icon preview",
          description: [
            "Sample presentation only — no raid or signup was created.",
            "",
            `${icon("go_raid_tank")} **Tank** · ${icon("go_spec_warrior_protection")} Protection Warrior`,
            `${icon("go_raid_healer")} **Healer** · ${icon("go_spec_priest_holy")} Holy Priest`,
            `${icon("go_raid_damage")} **Damage** · ${icon("go_spec_mage_fire")} Fire Mage`,
            `${icon("go_raid_damage")} **Damage** · ${icon("go_spec_druid_balance")} Balance Druid`,
          ].join("\n"),
          footer: { text: "Guild Operations · Discord emoji experiment" },
        }],
      };
      const message = await discordChannelMessage(configuration.botToken, channelId, payload);
      await publishOperationalRecord({
        source: "discord.application-emoji", operation: "presentation-preview",
        kind: "result", result: "success", actorIdentityId: identity.identityId,
        summary: "Discord emoji preview sent",
        details: { applicationId: configuration.applicationId, channelId, messageId: message.id },
      });
      return reply.code(303).redirect("/admin/discord?preview=success");
    } catch (error) {
      await publishOperationalRecord({
        source: "discord.application-emoji", operation: "presentation-preview",
        kind: "exception", actorIdentityId: identity.identityId,
        summary: "Discord emoji preview failed",
        details: { applicationId: configuration.applicationId, channelId,
          error: error instanceof Error ? error.message : String(error) },
      }).catch((recordError) => request.log.error({ err: recordError }, "Unable to record Discord preview failure"));
      request.log.error({ err: error }, "Discord emoji preview failed");
      return reply.code(303).redirect("/admin/discord?preview=failed");
    }
  });

  app.post("/admin/discord/raids", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send({ error: "discord_configuration_not_authorized" });
    }
    const configuration = await discordIntegrationConfiguration();
    if (!configuration?.enabled || !configuration.discordGuildId) return reply.code(409).send({ error: "discord_integration_not_ready" });
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body.channel_id !== "string") return reply.code(400).send({ error: "invalid_discord_raid_channel" });
    const expectedBinding = await requireOperationalInstallationGuildBinding();
    const channels = await discordServerChannels(configuration.botToken, configuration.discordGuildId);
    if (body.channel_id && !channels.some((channel) => channel.id === body.channel_id &&
      (channel.type === DISCORD_TEXT_CHANNEL || channel.type === DISCORD_ANNOUNCEMENT_CHANNEL))) {
      return reply.code(422).send({ error: "discord_raid_channel_unavailable" });
    }
    if (!await setDiscordRaidChannel(body.channel_id || null, expectedBinding)) {
      return reply.code(409).send({ error: "discord_configuration_changed_during_verification" });
    }
    return reply.redirect("/admin/modules");
  });

  app.post("/admin/discord/raffles", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send({ error: "discord_configuration_not_authorized" });
    }
    const configuration = await discordIntegrationConfiguration();
    if (!configuration?.enabled || !configuration.discordGuildId) return reply.code(409).send({ error: "discord_integration_not_ready" });
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body.channel_id !== "string") return reply.code(400).send({ error: "invalid_discord_raffle_channel" });
    const expectedBinding = await requireOperationalInstallationGuildBinding();
    const channels = await discordServerChannels(configuration.botToken, configuration.discordGuildId);
    if (body.channel_id && !channels.some((channel) => channel.id === body.channel_id &&
      (channel.type === DISCORD_TEXT_CHANNEL || channel.type === DISCORD_ANNOUNCEMENT_CHANNEL))) {
      return reply.code(422).send({ error: "discord_raffle_channel_unavailable" });
    }
    if (!await setDiscordRaffleChannel(body.channel_id || null, expectedBinding)) {
      return reply.code(409).send({ error: "discord_configuration_changed_during_verification" });
    }
    return reply.redirect("/admin/modules");
  });

  app.post("/admin/discord/articles", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send({ error: "discord_configuration_not_authorized" });
    }
    const configuration = await discordIntegrationConfiguration();
    if (!configuration?.enabled || !configuration.discordGuildId) return reply.code(409).send({ error: "discord_integration_not_ready" });
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body.channel_id !== "string") return reply.code(400).send({ error: "invalid_discord_article_channel" });
    const expectedBinding = await requireOperationalInstallationGuildBinding();
    const channels = await discordServerChannels(configuration.botToken, configuration.discordGuildId);
    const valid = channels.some((channel) => channel.id === body.channel_id && (channel.type === DISCORD_TEXT_CHANNEL || channel.type === DISCORD_ANNOUNCEMENT_CHANNEL));
    if (body.channel_id && !valid) return reply.code(422).send({ error: "discord_article_channel_unavailable" });
    if (!await setDiscordArticleChannel(body.channel_id || null, expectedBinding)) {
      return reply.code(409).send({ error: "discord_configuration_changed_during_verification" });
    }
    return reply.redirect("/admin/general");
  });

  app.post("/admin/discord/roles", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send({ error: "discord_configuration_not_authorized" });
    }
    const configuration = await discordIntegrationConfiguration();
    if (!configuration?.enabled || !configuration.discordGuildId || !configuration.botUserId) {
      return reply.code(409).send({ error: "discord_integration_not_ready" });
    }
    const binding = await requireOperationalInstallationGuildBinding();
    const guildId = binding.guildId;
    const [ranks, roles, botMember] = await Promise.all([
      guildRankDefinitions(guildId),
      discordServerRoles(configuration.botToken, configuration.discordGuildId),
      discordServerMember(configuration.botToken, configuration.discordGuildId, configuration.botUserId),
    ]);
    if (!botMember) return reply.code(409).send({ error: "discord_bot_not_in_server" });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const mappings = ranks.flatMap((rank) => {
      const value = body[`rank_${rank.rankIndex}`];
      return typeof value === "string" && value ? [{ rankIndex: rank.rankIndex, discordRoleId: value }] : [];
    });
    const readiness = discordRoleReadiness({
      roles, botRoleIds: botMember.roles, botUserId: configuration.botUserId,
      guildId: configuration.discordGuildId, mappedRoleIds: mappings.map((mapping) => mapping.discordRoleId),
    });
    if (!readiness.ready && mappings.length > 0) {
      return reply.code(422).send({ error: "discord_role_mapping_not_manageable", reasons: readiness.reasons });
    }
    try {
      await replaceDiscordRankRoleMappings({ guildId, boundAt: binding.boundAt, discordGuildId: configuration.discordGuildId, mappings });
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_discord_rank_role_mapping") {
        return reply.code(400).send({ error: error.message });
      }
      if (error instanceof Error && ["discord_guild_binding_changed", "discord_server_binding_changed"].includes(error.message)) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
    return reply.redirect("/admin/permissions");
  });

  app.post("/admin/discord/confirm-server", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send({ error: "discord_configuration_not_authorized" });
    }
    const configuration = await discordIntegrationConfiguration();
    if (!configuration?.applicationVerifiedAt || configuration.discordGuildId) {
      return reply.code(409).send({ error: "discord_server_confirmation_not_pending" });
    }
    const expectedBinding = await requireOperationalInstallationGuildBinding();
    const guilds = await discordBotGuilds(configuration.botToken);
    if (guilds.length !== 1) return reply.code(409).send({ error: "discord_server_binding_ambiguous" });
    if (!await establishDiscordGuildBinding(guilds[0].id, expectedBinding)) {
      return reply.code(409).send({ error: "discord_server_confirmation_state_changed" });
    }
    return reply.redirect("/admin/discord");
  });

  app.post("/admin/discord/reconnect", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send({ error: "discord_configuration_not_authorized" });
    }
    const replacement = await pendingDiscordApplicationReplacement();
    const host = hostDiscordCredentials();
    if (!replacement || !host) return reply.code(409).send({ error: "discord_reconnection_not_pending" });
    const expectedBinding = await requireOperationalInstallationGuildBinding();
    const application = await currentDiscordApplication(host.botToken);
    if (application.id !== host.applicationId || !application.verify_key) {
      return reply.code(409).send({ error: "discord_application_not_verified" });
    }
    const guilds = await discordBotGuilds(host.botToken);
    if (replacement.previousServerId && !guilds.some((guild) => guild.id === replacement.previousServerId)) {
      return reply.code(409).send({ error: "discord_new_bot_not_in_previous_server" });
    }
    const changed = await reconnectHostDiscordApplication({
      applicationName: application.name,
      botUserId: application.bot?.id ?? null,
      botUsername: application.bot?.username ?? null,
      interactionPublicKey: application.verify_key,
      discordGuildId: replacement.previousServerId,
      expectedBinding,
    });
    if (!changed) return reply.code(409).send({ error: "discord_reconnection_state_changed" });
    return reply.redirect("/admin/discord");
  });

  app.post("/admin/discord", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "authentication_required" });
    if (!await identityHasGuildCapability(identity.identityId, DISCORD_CONFIGURE_CAPABILITY)) {
      return reply.code(403).send({ error: "discord_configuration_not_authorized" });
    }
    if (!hostDiscordCredentials()) return reply.code(409).send({ error: "discord_host_configuration_required" });
    const configuration = await discordIntegrationConfiguration();
    if (!configuration?.applicationVerifiedAt) return reply.code(409).send({ error: "discord_application_not_verified" });
    const expectedBinding = await requireOperationalInstallationGuildBinding();
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body.enabled === "true") {
      if (!configuration.discordGuildId || !configuration.botUserId) {
        return reply.code(409).send({ error: "discord_server_not_established" });
      }
      const guildId = (await requireOperationalInstallationGuildBinding()).guildId;
      const [guilds, channels, roles, botMember, mappings] = await Promise.all([
        discordBotGuilds(configuration.botToken),
        discordServerChannels(configuration.botToken, configuration.discordGuildId),
        discordServerRoles(configuration.botToken, configuration.discordGuildId),
        discordServerMember(configuration.botToken, configuration.discordGuildId, configuration.botUserId),
        discordRankRoleMappings(guildId),
      ]);
      if (!guilds.some((guild) => guild.id === configuration.discordGuildId) || !botMember) {
        return reply.code(409).send({ error: "discord_bot_not_in_server" });
      }
      const configuredChannels = [configuration.articleChannelId, configuration.raidChannelId, configuration.raffleChannelId].filter(
        (id): id is string => id !== null,
      );
      const missingChannels = configuredChannels.filter((id) => !channels.some(
        (channel) => channel.id === id && (channel.type === DISCORD_TEXT_CHANNEL || channel.type === DISCORD_ANNOUNCEMENT_CHANNEL),
      ));
      if (missingChannels.length) {
        return reply.code(422).send({ error: "discord_configured_channels_unavailable", channelIds: missingChannels });
      }
      const channelProblems = configuredChannels.flatMap((id) => {
        const channel = channels.find((candidate) => candidate.id === id);
        if (!channel) return [];
        return discordChannelPublicationReadiness({
          channel, guildId: configuration.discordGuildId!, botUserId: configuration.botUserId!,
          botRoleIds: botMember.roles, roles,
          requireThreads: id === configuration.raffleChannelId,
        }).reasons;
      });
      if (channelProblems.length) {
        return reply.code(422).send({ error: "discord_channel_permissions_insufficient", reasons: channelProblems });
      }
      if (mappings.length) {
        const readiness = discordRoleReadiness({
          roles, botRoleIds: botMember.roles, botUserId: configuration.botUserId,
          guildId: configuration.discordGuildId, mappedRoleIds: mappings.map((mapping) => mapping.discordRoleId),
        });
        if (!readiness.ready) {
          return reply.code(422).send({ error: "discord_role_mapping_not_manageable", reasons: readiness.reasons });
        }
      }
    }
    if (body.enabled === "true") {
      const enabled = await enableVerifiedDiscordIntegration({
        applicationId: configuration.applicationId,
        discordGuildId: configuration.discordGuildId!,
        botUserId: configuration.botUserId!,
        articleChannelId: configuration.articleChannelId,
        raidChannelId: configuration.raidChannelId,
        raffleChannelId: configuration.raffleChannelId,
        expectedBinding,
      });
      if (!enabled) return reply.code(409).send({ error: "discord_configuration_changed_during_verification" });
    } else {
      if (!await setDiscordIntegrationEnabled(false, expectedBinding)) {
        return reply.code(409).send({ error: "discord_configuration_changed_during_verification" });
      }
    }
    await loadDiscordInteractionPublicKey();
    return reply.redirect("/admin/discord");
  });
}
