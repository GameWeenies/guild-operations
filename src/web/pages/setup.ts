import { pendingRosterRecovery } from "../../core/guild/roster-recovery.js";
import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE_NAME, authenticatedIdentity } from "../../auth.js";
import { pool } from "../../db.js";
import { installationGuildBinding, resolveConfiguredInstallationGuild } from "../../core/installation/guild-binding.js";
import { configuredInstallationGuild } from "../../core/installation/target.js";
import { installationRebindPreview } from "../../core/installation/rebinding.js";
import { assetUrl, type AssetRegistry } from "../assets.js";
import { installationBlizzardConfigured } from "../../core/installation/blizzard-configuration.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderSetupDocument(assets: AssetRegistry, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Set up Guild Operations</title><link rel="stylesheet" href="${assetUrl(assets, "app.css")}"><link rel="stylesheet" href="${assetUrl(assets, "setup.css")}"></head><body><main class="setup-shell"><section class="setup-card"><p class="eyebrow">First run</p><h1>Set up Guild Operations</h1>${body}</section></main><script src="${assetUrl(assets, "setup.js")}" defer></script></body></html>`;
}

export function renderAccountSelectionDocument(assets: AssetRegistry, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Choose your WoW account · Guild Operations</title><link rel="stylesheet" href="${assetUrl(assets, "app.css")}"><link rel="stylesheet" href="${assetUrl(assets, "setup.css")}"></head><body><main class="setup-shell account-selection-shell"><section class="setup-card account-selection-card"><p class="eyebrow">Blizzard sign in</p><h1>Choose your WoW account</h1><p class="account-selection-intro">Select the World of Warcraft account you want to use with Guild Operations.</p>${body}</section></main></body></html>`;
}

export async function registerSetupPage(app: FastifyInstance, assets: AssetRegistry): Promise<void> {
  app.get("/setup", async (request, reply) => {
    const blizzardConfigured = await installationBlizzardConfigured();
    if (!blizzardConfigured) {
      return reply.code(503).type("text/html; charset=utf-8").send(renderSetupDocument(
        assets,
        '<p>Configuration required</p><p>Guild Operations cannot complete initialization because its hosting environment is not configured correctly. Contact the server administrator to review the host configuration and restart the application.</p>',
      ));
    }

    const binding = await installationGuildBinding();
    if (binding?.authorizedAt) {
      let preview;
      try {
        preview = await installationRebindPreview();
      } catch (error) {
        request.log.warn({ err: error }, "Rebind destination resolution failed");
        return reply.code(503).type("text/html; charset=utf-8").send(renderSetupDocument(
          assets, "<p>Could not verify the pending destination guild with Blizzard. The existing guild binding remains active. Contact the host administrator to review the target configuration.</p>",
        ));
      }
      if (!preview) {
        const recovery = await pendingRosterRecovery();
        if (!recovery || recovery.guild_id !== binding.guildId) return reply.redirect("/");
        const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
        const details = '<p>Host-requested roster recovery</p><p>Blizzard Sync currently has no effective administrator. The originally verified Guild Master must authorize restoring the existing Manual roster. Blizzard observations and rank assignments will not be modified.</p>';
        if (!identity) return reply.type("text/html; charset=utf-8").send(renderSetupDocument(
          assets, `${details}<p><a class="button-primary setup-action" href="/auth/blizzard/start?return_to=%2Fsetup">Sign in with Blizzard</a></p>`,
        ));
        return reply.type("text/html; charset=utf-8").send(renderSetupDocument(
          assets, `${details}<form method="post" data-roster-recovery-authorize><button class="button-primary setup-action" type="submit">Authorize Manual roster recovery</button></form><p class="setup-status" data-setup-status aria-live="polite"></p>`,
        ));
      }
      const previous = preview.previous;
      const destination = preview.destination;
      const details = `<p>Host-requested guild rebinding</p>
        <div class="setup-selected-guild"><p class="setup-selected-label">Current guild</p><strong>${escapeHtml(previous.name ?? previous.guildId)}</strong><p>${escapeHtml(previous.realm_slug)} · ${escapeHtml(previous.region.toUpperCase())}</p></div>
        <div class="setup-selected-guild"><p class="setup-selected-label">Destination verified with Blizzard</p><strong>${escapeHtml(destination.name)}</strong><p>${escapeHtml(destination.realmSlug ?? destination.guildId)} · ${escapeHtml(destination.region.toUpperCase())}</p></div>
        <p>The destination Guild Master must authorize this change. Existing historical records are retained.</p>`;
      const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
      if (!identity) return reply.type("text/html; charset=utf-8").send(renderSetupDocument(
        assets, `${details}<p><a class="button-primary setup-action" href="/auth/blizzard/start?return_to=%2Fsetup">Sign in with Blizzard</a></p>`,
      ));
      return reply.type("text/html; charset=utf-8").send(renderSetupDocument(
        assets, `${details}<form method="post" data-rebind-authorize><button class="button-primary setup-action" type="submit">Authorize guild rebinding</button></form><p class="setup-status" data-setup-status aria-live="polite"></p>`,
      ));
    }

    if (!binding) {
      const target = configuredInstallationGuild();
      if (!target) {
        request.log.error("Installation guild target is missing or invalid");
        return reply.code(503).type("text/html; charset=utf-8").send(renderSetupDocument(
          assets, "<p>Guild target configuration required. Set GUILD_REGION, GUILD_REALM and GUILD_NAME in the host environment, then restart Guild Operations.</p>",
        ));
      }
      let resolved;
      try {
        resolved = await resolveConfiguredInstallationGuild();
      } catch (error) {
        request.log.error({ err: error, region: target.region, realm: target.realmSlug }, "Configured installation guild resolution failed");
        return reply.code(503).type("text/html; charset=utf-8").send(renderSetupDocument(
          assets, `<p>Could not verify the configured guild with Blizzard. Check the host guild target and Blizzard availability, then retry.</p><p>${escapeHtml(target.name)} — ${escapeHtml(target.realmSlug)} · ${escapeHtml(target.region.toUpperCase())}</p>`,
        ));
      }
      const guild = resolved.profile;
      const selected = `<div class="setup-selected-guild"><p class="setup-selected-label">Verified with Blizzard</p><strong>${escapeHtml(guild.name)}</strong><p>${escapeHtml(guild.realm.slug ?? target.realmSlug)} · ${escapeHtml(target.region.toUpperCase())}</p></div>`;
      const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
      if (!identity) {
        return reply.type("text/html; charset=utf-8").send(renderSetupDocument(
          assets, `<p>This installation is configured for:</p>${selected}<p>A current Guild Master must sign in to authorize this installation.</p><p><a class="button-primary setup-action" href="/auth/blizzard/start?return_to=%2Fsetup">Continue with Blizzard</a></p>`,
        ));
      }
      return reply.type("text/html; charset=utf-8").send(renderSetupDocument(
        assets, `<p>This installation is configured for:</p>${selected}<form method="post" data-setup-guild><button class="button-primary setup-action" type="submit">Continue to Guild Master verification</button></form><p class="setup-status" data-setup-status aria-live="polite"></p>`,
      ));
    }

    const guildResult = await pool.query<{ name: string; realm_name: string | null; realm_slug: string; region: string }>(
      "SELECT name, realm_name, realm_slug, region FROM guilds WHERE guild_id = $1",
      [binding.guildId],
    );
    const guild = guildResult.rows[0];
    if (!guild) throw new Error("Installation guild binding references a missing guild");
    const selectedGuild = `<div class="setup-selected-guild"><p class="setup-selected-label">Selected guild</p><strong>${escapeHtml(guild.name)}</strong><p>${escapeHtml(guild.realm_name ?? guild.realm_slug)} · ${escapeHtml(guild.region.toUpperCase())}</p></div>`;

    return reply.type("text/html; charset=utf-8").send(renderSetupDocument(
      assets,
      `<p>The guild has been identified. A current Guild Master must authorize this installation before it can operate.</p>${selectedGuild}<form method="post" data-setup-authorize><button class="button-primary setup-action" type="submit">Authorize Guild Operations</button></form><p>If you are not the Guild Master, sign out and have them continue setup with their Blizzard account.</p><form method="post" data-setup-signout><button class="button-secondary setup-action" type="submit">Sign out for Guild Master</button></form><p class="setup-status" data-setup-status aria-live="polite"></p>`,
    ));
  });
}
