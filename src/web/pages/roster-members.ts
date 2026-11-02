import { rosterMembersView } from "../../core/guild/roster-members-view.js";
import { rosterReconciliationPreview } from "../../core/guild/roster-reconciliation.js";
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
    let comparison;
    try {
      comparison = await rosterReconciliationPreview(identity.identityId);
    } catch (error) {
      if (error instanceof Error && error.message === "roster_management_forbidden") {
        return reply.code(403).send({ error: "roster_management_forbidden" });
      }
      throw error;
    }
    let preview = null;
    if (comparison.mode === "manual" && !comparison.manualInitialized) {
      try {
        preview = await manualRosterInitializationPreview(identity.identityId);
      } catch (error) {
        if (error instanceof Error && error.message === "roster_initialization_forbidden") {
          return reply.code(403).send({ error: "roster_initialization_forbidden" });
        }
        throw error;
      }
    }
    const membersView = await rosterMembersView(identity.identityId);
    const viewer = await viewerForRequest(token);
    const pending = comparison.mode === "manual" && !comparison.manualInitialized && preview !== null;
    const rows = (preview?.members ?? []).map((member) =>
      `<tr><td><label><input type="checkbox" name="member" value="${escapeHtml(member.characterRecordId)}" checked>
        <span>${escapeHtml(member.name)}-${escapeHtml(member.realm || "Unknown realm")}</span></label></td>
        <td>${member.level ?? "—"}</td><td>Rank ${member.rankIndex}</td></tr>`,
    ).join("");
    const review = `<section class="settings-panel" data-roster-review data-snapshot-version="${escapeHtml(preview?.snapshotVersion ?? "")}">
      <h2>Review initial membership</h2>
      <p>Blizzard's roster may be incomplete or stale. Select only characters you want to include in Guild Operations. Their observed ranks will be imported; missing characters can be added after initialization.</p>
      <p><strong>${preview?.members.length ?? 0}</strong> Blizzard-observed characters · <strong data-roster-selected>${preview?.members.length ?? 0}</strong> selected</p>
      <div class="roster-review-actions"><button type="button" class="button-secondary" data-roster-select-all>Select all</button>
      <button type="button" class="button-secondary" data-roster-clear>Clear selection</button></div>
      <div class="roster-review-scroll"><table><thead><tr><th>Character-Realm</th><th>Level</th><th>Observed rank</th></tr></thead><tbody>${rows}</tbody></table></div>
      <label class="roster-review-confirm"><input type="checkbox" data-roster-confirm> I have reviewed this selection and understand that Blizzard's snapshot may be stale.</label>
      <button type="button" class="button-primary" data-roster-commit disabled>Initialize Manual roster</button>
      <p role="status" aria-live="polite" data-roster-status></p>
    </section>`;
    let reconciliation = "";
    if (comparison.mode === "blizzard_sync") {
      const differences = comparison.differences.map((difference) => {
        const label = difference.kind === "declared_only" ? "Absent from Blizzard" :
          difference.kind === "observed_only" ? "Absent from Manual" : "Rank differs";
        return `<tr><td><label><input type="checkbox" name="reconcile-member" value="${escapeHtml(difference.characterRecordId)}" checked>
          ${escapeHtml(difference.name)}-${escapeHtml(difference.realm || "Unknown realm")}</label></td>
          <td>${escapeHtml(label)}</td>
          <td>${difference.declaredRank === null ? "Not declared" : `Rank ${difference.declaredRank}`}</td>
          <td>${difference.observedRank === null ? "Not observed" : `Rank ${difference.observedRank}`}</td></tr>`;
      }).join("");
      reconciliation = `<section class="settings-panel" data-roster-reconciliation data-snapshot-version="${escapeHtml(comparison.snapshotVersion)}">
        <h2>Switch to Manual roster</h2>
        <p>Review differences between the declared roster and the latest Blizzard observation. Selected differences will adopt Blizzard's observed membership or rank; unselected differences will retain the declared value.</p>
        <p>Blizzard snapshot acquired: ${comparison.observationAcquiredAt ? escapeHtml(new Date(comparison.observationAcquiredAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "Unavailable"}.
        Source last modified: ${comparison.sourceLastModifiedAt ? escapeHtml(new Date(comparison.sourceLastModifiedAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "Not provided by Blizzard"}.</p>
        <p><strong>${comparison.differences.length}</strong> differences · <strong data-reconciliation-selected>${comparison.differences.length}</strong> selected</p>
        <div class="roster-review-actions"><button type="button" class="button-secondary" data-reconciliation-all>Select all</button>
        <button type="button" class="button-secondary" data-reconciliation-none>Deselect all</button></div>
        ${comparison.differences.length ? `<div class="roster-review-scroll"><table><thead><tr><th>Character-Realm</th><th>Difference</th><th>Manual</th><th>Blizzard</th></tr></thead><tbody>${differences}</tbody></table></div>` :
          "<p>The rosters currently agree. You can switch without applying any changes.</p>"}
        <label class="roster-review-confirm"><input type="checkbox" data-reconciliation-confirm> I have reviewed the differences and understand that Blizzard's snapshot may be stale.</label>
        <button type="button" class="button-primary" data-reconciliation-commit disabled>Activate Manual roster</button>
        <p role="status" aria-live="polite" data-reconciliation-status></p>
      </section>`;
    }
    const memberRows = membersView.members.map((member) => {
      const name = `${escapeHtml(member.name)}-${escapeHtml(member.realm || "Unknown realm")}`;
      const discrepancy = member.discrepancy
        ? ` <span title="Blizzard observed: ${member.observedRank === null ? "Not present" : `Rank ${member.observedRank}`}. Guild Operations declared: Rank ${member.rankIndex}.">⚠</span>`
        : "";
      return `<tr><td>${name} ${member.level === null ? "" : `(Level ${member.level})`}</td>
        <td>${escapeHtml(member.rankDisplayName ?? `Rank ${member.rankIndex}`)}${discrepancy}</td>
        ${membersView.mode === "manual" ? "<td>—</td>" : ""}</tr>`;
    }).join("");
    const membersTable = `<section class="settings-panel"><h2>Members</h2>
      <p>${membersView.mode === "manual" ? "Guild Operations declared membership is authoritative." : "Blizzard-observed membership is authoritative. This roster is read-only."}</p>
      <div class="roster-review-scroll"><table><thead><tr><th>Character-Realm (level)</th><th>Rank</th>${membersView.mode === "manual" ? "<th>Actions</th>" : ""}</tr></thead>
      <tbody>${memberRows || `<tr><td colspan="${membersView.mode === "manual" ? 3 : 2}">No members in the effective roster.</td></tr>`}</tbody></table></div>
    </section>`;
    const body = pending ? review : reconciliation || (membersView.initialized ? membersTable : `<section class="settings-panel"><h2>Members</h2><p>${comparison.manualInitialized
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
