import type { FastifyInstance } from "fastify";
import { authenticatedIdentity, SESSION_COOKIE_NAME } from "../../auth.js";
import { manualRosterInitializationPreview } from "../../core/guild/roster-initialization-operation.js";
import type { AssetRegistry } from "../assets.js";
import { renderPage } from "../render.js";
import { viewerForRequest } from "../viewer.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export async function registerRosterMembersPage(app: FastifyInstance, assets: AssetRegistry): Promise<void> {
  app.get("/roster", async (_request, reply) => reply.redirect("/roster/members"));
  app.get("/roster/members", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    const identity = await authenticatedIdentity(token);
    if (!identity) return reply.redirect("/auth/blizzard/start?return_to=%2Froster%2Fmembers");
    let preview;
    try {
      preview = await manualRosterInitializationPreview(identity.identityId);
    } catch (error) {
      if (error instanceof Error && error.message === "roster_initialization_forbidden") {
        return reply.code(403).send({ error: "roster_initialization_forbidden" });
      }
      throw error;
    }
    const viewer = await viewerForRequest(token);
    const pending = preview.mode === "manual" && !preview.initialized;
    const rows = preview.members.map((member) =>
      `<tr><td><label><input type="checkbox" name="member" value="${escapeHtml(member.characterRecordId)}" checked>
        <span>${escapeHtml(member.name)}-${escapeHtml(member.realm || "Unknown realm")}</span></label></td>
        <td>${member.level ?? "—"}</td><td>Rank ${member.rankIndex}</td></tr>`,
    ).join("");
    const review = `<section class="settings-panel" data-roster-review data-snapshot-version="${escapeHtml(preview.snapshotVersion)}">
      <h2>Review initial membership</h2>
      <p>Blizzard's roster may be incomplete or stale. Select only characters you want to include in Guild Operations. Their observed ranks will be imported; missing characters can be added after initialization.</p>
      <p><strong>${preview.members.length}</strong> Blizzard-observed characters · <strong data-roster-selected>${preview.members.length}</strong> selected</p>
      <div class="roster-review-actions"><button type="button" class="button-secondary" data-roster-select-all>Select all</button>
      <button type="button" class="button-secondary" data-roster-clear>Clear selection</button></div>
      <div class="roster-review-scroll"><table><thead><tr><th>Character-Realm</th><th>Level</th><th>Observed rank</th></tr></thead><tbody>${rows}</tbody></table></div>
      <label class="roster-review-confirm"><input type="checkbox" data-roster-confirm> I have reviewed this selection and understand that Blizzard's snapshot may be stale.</label>
      <button type="button" class="button-primary" data-roster-commit disabled>Initialize Manual roster</button>
      <p role="status" aria-live="polite" data-roster-status></p>
    </section>`;
    const body = pending ? review : `<section class="settings-panel"><h2>Members</h2><p>${preview.initialized
      ? "The Manual roster has been initialized. Member management will be available in a subsequent release step."
      : "Roster initialization is not available in the current management mode."}</p></section>`;
    return reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(renderPage(assets, {
      pathname: "/roster/members",
      title: `Roster · ${viewer.guildPresentation.guildName} Guild Operations`,
      description: "Review and initialize guild membership.",
      viewer,
      stylesheets: ["admin.css", "roster.css"],
      scripts: ["roster.js"],
      header: '<div class="admin-page-header"><h1>Roster</h1><p class="lede">Members</p></div>',
      body,
    }));
  });
}
