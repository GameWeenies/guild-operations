import { identityHasGuildCapability, GUILD_REFRESH_CAPABILITY } from "../../core/authority/guild-permissions.js";
import { pendingRosterApplications } from "../../core/guild/roster-applications.js";
import { guildRankDefinitions } from "../../core/guild/guild-ranks.js";
import { manualRosterCharacterCandidates } from "../../core/guild/manual-roster-character-candidates.js";
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
    const manualControls = comparison.mode === "manual" && comparison.manualInitialized;
    const [ranks, candidates, applications] = manualControls
      ? await Promise.all([guildRankDefinitions(comparison.guildId), manualRosterCharacterCandidates(identity.identityId), pendingRosterApplications(identity.identityId)])
      : [[], null, null];
    const rankOptions = ranks.map((rank) => `<option value="${rank.rankIndex}">${escapeHtml(rank.displayName)}</option>`).join("");
    const [viewer, canRefresh] = await Promise.all([viewerForRequest(token), identityHasGuildCapability(identity.identityId, GUILD_REFRESH_CAPABILITY)]);
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
      const controls = manualControls ? `<td><div class="roster-member-controls" data-member-id="${escapeHtml(member.characterRecordId)}"><select aria-label="Rank for ${name}" data-member-rank>${ranks.map((rank) => `<option value="${rank.rankIndex}"${rank.rankIndex === member.rankIndex ? " selected" : ""}>${escapeHtml(rank.displayName)}</option>`).join("")}</select><button type="button" class="button-secondary" data-member-save disabled>Save rank</button><button type="button" class="button-secondary" data-member-remove>Remove</button><span role="status" aria-live="polite" data-member-status></span></div></td>` : "";
      return `<tr><td>${name} ${member.level === null ? "" : `(Level ${member.level})`}</td>
        <td>${escapeHtml(member.rankDisplayName ?? `Rank ${member.rankIndex}`)}${discrepancy}</td>${controls}</tr>`;
    }).join("");
    const membersTable = `<section class="settings-panel" data-roster-members><h2>Members</h2>
      <p>${membersView.mode === "manual" ? "Guild Operations declared membership is authoritative." : "Blizzard-observed membership is authoritative. This roster is read-only."}</p>
      <div class="roster-review-scroll"><table><thead><tr><th>Character-Realm (level)</th><th>Rank</th>${manualControls ? "<th>Actions</th>" : ""}</tr></thead>
      <tbody>${memberRows || `<tr><td colspan="${manualControls ? 3 : 2}">No members in the effective roster.</td></tr>`}</tbody></table></div>
      ${manualControls ? `<div class="roster-add-member"><h3>Add member</h3><label>Character <select data-member-add-character>${(candidates?.characters ?? []).map((character) => `<option value="${escapeHtml(character.characterRecordId)}">${escapeHtml(character.name)}-${escapeHtml(character.realm ?? "Unknown realm")}</option>`).join("")}</select></label><label>Rank <select data-member-add-rank>${rankOptions}</select></label><button type="button" class="button-primary" data-member-add${candidates?.characters.length ? "" : " disabled"}>Add member</button><p role="status" aria-live="polite" data-member-add-status></p></div>` : ""}
    </section>`;
    const applicantRows = (applications?.applications ?? []).map((application) => {
      const character = `${escapeHtml(application.name)}-${escapeHtml(application.realm_slug || "Unknown realm")}`;
      return `<tr data-application-id="${escapeHtml(application.application_id)}">
        <td>${character}${application.level === null ? "" : ` (Level ${application.level})`}</td>
        <td><div class="roster-member-controls">
          <select data-application-rank aria-label="Rank for ${character}">${rankOptions}</select>
          <button type="button" class="button-primary" data-application-approve${ranks.length ? "" : " disabled"}>Approve</button>
          <button type="button" class="button-secondary" data-application-reject>Reject</button>
          <span role="status" aria-live="polite" data-application-status></span>
        </div></td></tr>`;
    }).join("");
    const applicantReview = manualControls ? `<section class="settings-panel" data-roster-applications>
      <h2>Pending applications</h2>
      <p>Approve a character into the Manual roster at the selected rank, or reject the application.</p>
      ${applicantRows ? `<div class="roster-review-scroll"><table><thead><tr><th>Character-Realm (level)</th><th>Review</th></tr></thead><tbody>${applicantRows}</tbody></table></div>` :
        "<p>No pending applications.</p>"}
    </section>` : "";
    const syncTransition = manualControls ? `<section class="settings-panel" data-roster-blizzard-sync>
      <h2>Roster management mode</h2>
      <p><strong>Current mode: Manual.</strong> Guild Operations manages effective membership and ranks.</p>
      <p>Switching to Blizzard Sync makes Blizzard's last observed roster authoritative for membership and ranks. Blizzard data may be stale or incomplete, and this can immediately change access and participation. Your Manual declarations are preserved for a later return to Manual mode.</p>
      <p>Snapshot acquired: ${comparison.observationAcquiredAt ? escapeHtml(new Date(comparison.observationAcquiredAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "Unavailable"}.
      Blizzard source last modified: ${comparison.sourceLastModifiedAt ? escapeHtml(new Date(comparison.sourceLastModifiedAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "Not provided"}.</p>
      <label class="roster-review-confirm"><input type="checkbox" data-blizzard-sync-acknowledge> I understand that Blizzard's roster may be stale or incomplete and switching authority may change guild access.</label>
      <button type="button" class="button-secondary" data-blizzard-sync-commit disabled>Switch to Blizzard Sync</button>
      <p role="status" aria-live="polite" data-blizzard-sync-status></p>
    </section>` : "";
    const observationControls = `<section class="settings-panel" data-roster-observation>
      <h2>Blizzard roster observation</h2>
      <p>Refresh retrieves Blizzard's latest available snapshot. Blizzard may return stale or incomplete membership even after a successful refresh.</p>
      <p>Last acquired: ${comparison.observationAcquiredAt ? escapeHtml(new Date(comparison.observationAcquiredAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "No snapshot available"}.</p>
      <p>Blizzard source last modified: ${comparison.sourceLastModifiedAt ? escapeHtml(new Date(comparison.sourceLastModifiedAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "Not provided"}.</p>
      <p>${comparison.mode === "manual" ? "Manual membership and ranks remain authoritative after refreshing the Blizzard observation." : "Blizzard Sync uses the observed roster for effective membership and ranks; a refresh may change access."}</p>
      <button type="button" class="button-secondary" data-roster-refresh${canRefresh ? "" : " disabled"}>Refresh Blizzard snapshot</button>
      ${canRefresh ? "" : "<p>You do not have permission to refresh the guild snapshot.</p>"}
      <p role="status" aria-live="polite" data-roster-refresh-status></p>
    </section>`;
    const body = pending ? review : (membersView.initialized ? `${observationControls}${membersTable}${applicantReview}${reconciliation}${syncTransition}` : `<section class="settings-panel"><h2>Members</h2><p>${comparison.manualInitialized
      ? "The Manual roster has been initialized. Member management will be available in a subsequent release step."
      : "Roster initialization is not available in the current management mode."}</p></section>`);
    return reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(renderPage(assets, {
      pathname: "/roster/members",
      title: `Roster · ${viewer.guildPresentation.guildName} Guild Operations`,
      description: "Review and initialize guild membership.",
      viewer,
      stylesheets: ["admin.css", "roster.css"],
      scripts: ["roster.js"],
      header: '<div class="admin-page-header"><h1>Roster</h1><p class="lede">Members</p></div><nav aria-label="Roster sections"><a href="/roster/members">Members</a> · <a href="/roster/ranks">Ranks</a></nav>',
      body,
    }));
  });
}
