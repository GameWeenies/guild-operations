import { pool } from "../../db.js";
import { requireOperationalInstallationGuildBinding } from "../../core/installation/guild-binding.js";
import { identityHasGuildCapability, GUILD_REFRESH_CAPABILITY } from "../../core/authority/guild-permissions.js";
import { renderGuildRefreshSchedule, renderGuildRefreshOperation } from "./admin.js";
import { guildRefreshSchedule } from "../../core/guild/guild-refresh-schedule.js";
import { guildRefreshStatus } from "../../core/guild/guild-refresh-status.js";
import { GUILD_REFRESH_SCHEDULE_CONFIGURE_CAPABILITY } from "../../core/authority/guild-permissions.js";
import { renderGuildSettingsHeader } from "../render.js";
import { pendingRosterApplications } from "../../core/guild/roster-applications.js";
import { guildRankDefinitions } from "../../core/guild/guild-ranks.js";
import { manualRosterCharacterCandidates } from "../../core/guild/manual-roster-character-candidates.js";
import { rosterMembersView } from "../../core/guild/roster-members-view.js";
import { rosterReconciliationPreview } from "../../core/guild/roster-reconciliation.js";
import type { FastifyInstance } from "fastify";
import { authenticatedIdentity, SESSION_COOKIE_NAME } from "../../auth.js";
import { manualRosterInitializationPreview } from "../../core/guild/roster-initialization-operation.js";
import type { AssetRegistry } from "../assets.js";
import { renderPage, renderPageSectionStack, renderPanel, renderTableFrame, renderSortableColumnHeader } from "../render.js";
import { viewerForRequest } from "../viewer.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function rosterNavigation(section: "members" | "synchronization"): string {
  return `<nav aria-label="Roster sections" class="roster-section-navigation"><a href="/admin/roster/members"${section === "members" ? ' aria-current="page"' : ""}>Members</a><a href="/admin/roster/ranks">Ranks</a><a href="/admin/roster/synchronization"${section === "synchronization" ? ' aria-current="page"' : ""}>Synchronization</a></nav>`;
}

export async function registerRosterMembersPage(app: FastifyInstance, assets: AssetRegistry): Promise<void> {
  app.get("/roster", async (_request, reply) => reply.redirect("/admin/roster/members"));
  app.get("/roster/members", async (_request, reply) => reply.redirect("/admin/roster/members"));
  app.get("/admin/roster", async (_request, reply) => reply.redirect("/admin/roster/members"));
  for (const section of ["members", "synchronization"] as const) {
  app.get(`/admin/roster/${section}`, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    const identity = await authenticatedIdentity(token);
    if (!identity) return reply.redirect(`/auth/blizzard/start?return_to=%2Fadmin%2Froster%2F${section}`);
    // Bootstrap uses the verified installation GM, not rank-derived authority:
    // an uninitialized Manual roster has no effective members or GO rank 0.
    const binding = await requireOperationalInstallationGuildBinding();
    const state = await pool.query<{ mode: "manual" | "blizzard_sync"; manual_initialized_at: Date | null }>(
      "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1",
      [binding.guildId],
    );
    if (!state.rowCount) throw new Error("roster_management_missing");
    const bootstrap = state.rows[0].mode === "manual" && !state.rows[0].manual_initialized_at;
    if (bootstrap && section === "synchronization") return reply.redirect("/admin/roster/members");
    if (bootstrap) {
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
      const rows = preview.members.map((member) =>
        `<tr><td><label><input type="checkbox" name="member" value="${escapeHtml(member.characterRecordId)}" checked>
          <span>${escapeHtml(member.name)}-${escapeHtml(member.realm || "Unknown realm")}</span></label></td>
          <td>${member.level ?? "—"}</td><td>Rank ${member.rankIndex}</td></tr>`,
      ).join("");
      const review = `${renderPanel(`
        <h2>Review initial membership</h2>
        <p>Blizzard's roster may be incomplete or stale. Select only characters you want to include in Guild Operations. Their observed ranks will be imported; missing characters can be added after initialization. The character used to verify the Guild Master will be included as Rank 0 regardless of this selection, to establish initial operational administration.</p>
        <p><strong>${preview.members.length}</strong> Blizzard-observed characters · <strong data-roster-selected>${preview.members.length}</strong> selected</p>
        <div class="roster-review-actions"><button type="button" class="button-secondary" data-roster-select-all>Select all</button>
        <button type="button" class="button-secondary" data-roster-clear>Clear selection</button></div>
        <div class="roster-review-scroll"><table><thead><tr><th>Character-Realm</th><th>Level</th><th>Observed rank</th></tr></thead><tbody>${rows}</tbody></table></div>
        <label class="roster-review-confirm"><input type="checkbox" data-roster-confirm> I have reviewed this selection and understand that Blizzard's snapshot may be stale.</label>
        <button type="button" class="button-primary" data-roster-commit disabled>Initialize Manual roster</button>
        <p role="status" aria-live="polite" data-roster-status></p>
      `, { element: "section", attributes: { "data-roster-review": true, "data-snapshot-version": preview.snapshotVersion } })}`;
      return reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(renderPage(assets, {
        pathname: "/admin/roster/members",
        title: `Roster · ${viewer.guildPresentation.guildName} Guild Operations`,
        description: "Review initial guild membership.",
        viewer, stylesheets: ["admin.css", "roster.css"], scripts: ["roster.js", "admin.js"],
        header: `${renderGuildSettingsHeader("Roster", "Manage guild membership and ranks.")}${rosterNavigation(section)}`,
        body: review,
      }));
    }
    let comparison;
    try {
      comparison = await rosterReconciliationPreview(identity.identityId);
    } catch (error) {
      if (error instanceof Error && error.message === "roster_management_forbidden") {
        return reply.code(403).send({ error: "roster_management_forbidden" });
      }
      throw error;
    }
    const membersView = await rosterMembersView(identity.identityId);
    const manualControls = comparison.mode === "manual" && comparison.manualInitialized;
    const [ranks, candidates, applications] = manualControls
      ? await Promise.all([guildRankDefinitions(comparison.guildId), manualRosterCharacterCandidates(identity.identityId), pendingRosterApplications(identity.identityId)])
      : [[], null, null];
    const rankOptions = ranks.map((rank) => `<option value="${rank.rankIndex}">${escapeHtml(rank.displayName)}</option>`).join("");
    const [viewer, canRefresh] = await Promise.all([viewerForRequest(token), identityHasGuildCapability(identity.identityId, GUILD_REFRESH_CAPABILITY)]);
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
      reconciliation = `${renderPanel(`
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
      `, { element: "section", attributes: { "data-roster-reconciliation": true, "data-snapshot-version": comparison.snapshotVersion } })}`;
    }
    const sortedMembers = [...membersView.members].sort((a, b) => a.rankIndex - b.rankIndex || `${a.name}-${a.realm ?? ""}`.localeCompare(`${b.name}-${b.realm ?? ""}`, undefined, { sensitivity: "base" }));
    const memberRows = sortedMembers.map((member) => {
      const name = `${escapeHtml(member.name)}-${escapeHtml(member.realm || "Unknown realm")}`;
      const discrepancy = member.discrepancy
        ? ` <span title="Blizzard observed: ${member.observedRank === null ? "Not present" : `Rank ${member.observedRank}`}. Guild Operations declared: Rank ${member.rankIndex}.">⚠</span>`
        : "";
      const controls = manualControls ? `<td data-label="Actions"><div class="roster-member-controls" data-member-id="${escapeHtml(member.characterRecordId)}"><select aria-label="Rank for ${name}" data-member-rank>${ranks.map((rank) => `<option value="${rank.rankIndex}"${rank.rankIndex === member.rankIndex ? " selected" : ""}>${escapeHtml(rank.displayName)}</option>`).join("")}</select><button type="button" class="button-secondary" data-member-save disabled>Save rank</button><button type="button" class="button-secondary" data-member-remove>Remove</button><span role="status" aria-live="polite" data-member-status></span></div></td>` : "";
      return `<tr data-roster-member-row data-rank-index="${member.rankIndex}" data-character-name="${name}"><td>${name} ${member.level === null ? "" : `(Level ${member.level})`}</td>
        <td>${escapeHtml(member.rankDisplayName ?? `Rank ${member.rankIndex}`)}${discrepancy}</td>${controls}</tr>`;
    }).join("");
    const membersTable = `${renderPanel(`<h2>Members</h2>
      <p>${membersView.mode === "manual" ? "Guild Operations declared membership is authoritative." : "Blizzard-observed membership is authoritative. This roster is read-only."}</p>
      ${renderTableFrame(`<table data-roster-sort-table><thead><tr>${renderSortableColumnHeader("Character", "name")}${renderSortableColumnHeader("Rank", "rank", true)}${manualControls ? '<th scope="col">Actions</th>' : ""}</tr></thead>
      <tbody>${memberRows || `<tr><td colspan="${manualControls ? 3 : 2}">No members in the effective roster.</td></tr>`}</tbody></table>`, { compactRecords: true })}
      ${manualControls ? `<div class="roster-add-member"><h3>Add member</h3><label>Character <select data-member-add-character>${(candidates?.characters ?? []).map((character) => `<option value="${escapeHtml(character.characterRecordId)}">${escapeHtml(character.name)}-${escapeHtml(character.realm ?? "Unknown realm")}</option>`).join("")}</select></label><label>Rank <select data-member-add-rank>${rankOptions}</select></label><button type="button" class="button-primary" data-member-add${candidates?.characters.length ? "" : " disabled"}>Add member</button><p role="status" aria-live="polite" data-member-add-status></p></div>` : ""}
    `, { element: "section", attributes: { "data-roster-members": true } })}`;
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
    const applicantReview = manualControls ? `${renderPanel(`
      <h2>Pending applications</h2>
      <p>Approve a character into the Manual roster at the selected rank, or reject the application.</p>
      ${applicantRows ? `<div class="roster-review-scroll"><table><thead><tr><th>Character-Realm (level)</th><th>Review</th></tr></thead><tbody>${applicantRows}</tbody></table></div>` :
        "<p>No pending applications.</p>"}
    `, { element: "section", attributes: { "data-roster-applications": true } })}` : "";
    const syncTransition = manualControls ? `${renderPanel(`
      <h2>Roster management mode</h2>
      <p><strong>Current mode: Manual.</strong> Guild Operations manages effective membership and ranks.</p>
      <p>Switching to Blizzard Sync makes Blizzard's last observed roster authoritative for membership and ranks. Blizzard data may be stale or incomplete, and this can immediately change access and participation. Your Manual declarations are preserved for a later return to Manual mode.</p>
      <p>Snapshot acquired: ${comparison.observationAcquiredAt ? escapeHtml(new Date(comparison.observationAcquiredAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "Unavailable"}.
      Blizzard source last modified: ${comparison.sourceLastModifiedAt ? escapeHtml(new Date(comparison.sourceLastModifiedAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "Not provided"}.</p>
      <label class="roster-review-confirm"><input type="checkbox" data-blizzard-sync-acknowledge> I understand that Blizzard's roster may be stale or incomplete and switching authority may change guild access.</label>
      <button type="button" class="button-secondary" data-blizzard-sync-commit disabled>Switch to Blizzard Sync</button>
      <p role="status" aria-live="polite" data-blizzard-sync-status></p>
    `, { element: "section", attributes: { "data-roster-blizzard-sync": true } })}` : "";
    const [refreshSchedule, refreshStatus, canSchedule] = section === "synchronization"
      ? await Promise.all([guildRefreshSchedule(), guildRefreshStatus(), identityHasGuildCapability(identity.identityId, GUILD_REFRESH_SCHEDULE_CONFIGURE_CAPABILITY)])
      : [null, null, false] as const;
    const schedule = refreshSchedule ? renderGuildRefreshSchedule(refreshSchedule) : "";
    const synchronization = refreshStatus ? `<section class="admin-section"><h2>Guild synchronization</h2>${renderPanel(`${canSchedule ? schedule : schedule.replaceAll("<input ", "<input disabled ").replaceAll("<button type=\"submit\"", "<button disabled type=\"submit\"")}${renderGuildRefreshOperation(refreshStatus, canRefresh)}`, { className: "guild-synchronization-settings" })}</section>` : "";
    const observationControls = `${renderPanel(`
      <h2>Blizzard roster observation</h2>
      <p>Refresh retrieves Blizzard's latest available snapshot. Blizzard may return stale or incomplete membership even after a successful refresh.</p>
      <p>Last acquired: ${comparison.observationAcquiredAt ? escapeHtml(new Date(comparison.observationAcquiredAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "No snapshot available"}.</p>
      <p>Blizzard source last modified: ${comparison.sourceLastModifiedAt ? escapeHtml(new Date(comparison.sourceLastModifiedAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })) : "Not provided"}.</p>
      <p>${comparison.mode === "manual" ? "Manual membership and ranks remain authoritative after refreshing the Blizzard observation." : "Blizzard Sync uses the observed roster for effective membership and ranks; a refresh may change access."}</p>
    `, { element: "section", attributes: { "data-roster-observation": true } })}`;
    const body = section === "synchronization" ? renderPageSectionStack(synchronization, observationControls, reconciliation, syncTransition) : membersView.initialized ? renderPageSectionStack(membersTable, applicantReview) : `${renderPanel(`<h2>Members</h2><p>${comparison.manualInitialized
      ? "The Manual roster has been initialized. Member management will be available in a subsequent release step."
      : "Roster initialization is not available in the current management mode."}</p>`, { element: "section" })}`;
    return reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(renderPage(assets, {
      pathname: `/admin/roster/${section}`,
      title: `Roster ${section === "members" ? "Members" : "Synchronization"} · ${viewer.guildPresentation.guildName} Guild Operations`,
      description: section === "members" ? "Manage guild membership." : "Manage Blizzard synchronization and roster authority.",
      viewer,
      stylesheets: ["admin.css", "roster.css"],
      scripts: ["roster.js", "admin.js"],
      header: `${renderGuildSettingsHeader("Roster", "Manage guild membership and ranks.")}${rosterNavigation(section)}`,
      body,
    }));
  });
  }
}
