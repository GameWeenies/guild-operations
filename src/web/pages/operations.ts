import type { FastifyInstance } from "fastify";
import { authenticatedIdentity, SESSION_COOKIE_NAME } from "../../auth.js";
import {
  OPERATIONS_INSPECT_CAPABILITY,
  identityHasGuildCapability,
} from "../../core/authority/guild-permissions.js";
import {
  listOperationalRecords,
  type OperationalRecord,
  type OperationalRecordKind,
} from "../../operational-inspection.js";
import type { AssetRegistry } from "../assets.js";
import { renderPage, renderAdminSectionStack } from "../render.js";
import { viewerForRequest } from "../viewer.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderDetails(details: Record<string, unknown> | null): string {
  if (!details) return "";
  const serialized = JSON.stringify(details, null, 2);
  return `<details class="operations-record-details">
    <summary>Details</summary>
    <pre>${escapeHtml(serialized)}</pre>
  </details>`;
}

function renderRecord(record: OperationalRecord): string {
  const result = record.result
    ? `<span class="operations-record-result operations-record-result-${record.result}">${escapeHtml(record.result)}</span>`
    : "";
  const actor = record.actorIdentityId
    ? `<span class="operations-record-actor">Actor: ${escapeHtml(record.actorIdentityId)}</span>`
    : "";

  return `<article class="operations-record">
    <div class="operations-record-heading">
      <time data-unix-time="${record.occurredAtUnix}">${record.occurredAtUnix}</time>
      <span class="operations-record-source">${escapeHtml(record.source)}</span>
      <span aria-hidden="true">·</span>
      <span class="operations-record-operation">${escapeHtml(record.operation)}</span>
      <span class="operations-record-kind">${escapeHtml(record.kind)}</span>
      ${result}
    </div>
    <p class="operations-record-summary">${escapeHtml(record.summary)}</p>
    <small class="operations-record-id">Record ID: <code>${escapeHtml(record.operationalRecordId)}</code></small>
    ${actor}
    ${renderDetails(record.details)}
  </article>`;
}

function normalizedKind(value: string | undefined): OperationalRecordKind | undefined {
  if (value === "result" || value === "exception") return value;
  return undefined;
}

function renderInspection(
  records: OperationalRecord[],
  source: string | undefined,
  kind: OperationalRecordKind | undefined,
): string {
  const channelLinks = `<nav aria-label="Operational log channels"><a href="/admin/history">All logs</a> · <a href="/admin/history?source=discord.role-sync">Discord synchronization</a></nav>`;
  const filters = `<form class="operations-filters" method="get" action="/admin/history">
    <label>
      <span>Source</span>
      <input type="text" name="source" value="${escapeHtml(source ?? "")}" placeholder="Any source">
    </label>
    <label>
      <span>Kind</span>
      <select name="kind">
        <option value=""${kind === undefined ? " selected" : ""}>Any kind</option>
        <option value="result"${kind === "result" ? " selected" : ""}>Result</option>
        <option value="exception"${kind === "exception" ? " selected" : ""}>Exception</option>
      </select>
    </label>
    <button type="submit">Apply</button>
    ${(source || kind) ? '<a href="/admin/history">Clear</a>' : ""}
  </form>`;

  return `<section class="operations-inspection admin-section" aria-labelledby="operations-records-heading">
    <h2 id="operations-records-heading">Operational logs</h2>
    <p class="admin-section-note">Review recorded operational results and exceptions. Record IDs can be searched in container logs to find the matching persistence event.</p>
    ${channelLinks}
    ${filters}
    <div class="operations-records-heading">
      <h3>Recent records</h3>
      <span>${records.length} shown</span>
    </div>
    <div class="operations-records">
      ${records.length
        ? records.map(renderRecord).join("\n")
        : '<p class="operations-empty">No operational records match this view.</p>'}
    </div>
  </section>`;
}

export async function registerOperationsAdminPage(
  app: FastifyInstance,
  assets: AssetRegistry,
): Promise<void> {
  app.get("/admin/operations", async (_request, reply) => reply.redirect("/admin/history"));

  app.get("/operations", async (_request, reply) => reply.redirect("/admin/history"));

  app.get("/admin/history", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    const [viewer, identity] = await Promise.all([
      viewerForRequest(sessionToken),
      authenticatedIdentity(sessionToken),
    ]);

    const canInspect = identity ? await identityHasGuildCapability(identity.identityId, OPERATIONS_INSPECT_CAPABILITY) : false;

    const query = request.query as { source?: string; kind?: string };
    const source = query.source?.trim() || undefined;
    const kind = normalizedKind(query.kind);
    const records = canInspect ? await listOperationalRecords({ source, kind, limit: 100 }) : [];

    const sections = canInspect ? renderInspection(records, source, kind) : "";

    const body = sections
      ? renderAdminSectionStack(sections)
      : `<section class="admin-unavailable"><h2>Logs are not available for this account.</h2></section>`;

    const html = renderPage(assets, {
      pathname: "/admin/history",
      title: `Logs · ${viewer.guildPresentation.guildName} Guild Operations`,
      description: "Inspect recorded Guild Operations logs.",
      viewer,
      stylesheets: ["admin.css"],
      scripts: ["operations.js"],
      header: `
        <div class="admin-page-header">
          <h1 id="page-title">Settings</h1>
          <p class="lede">Inspect recorded Guild Operations outcomes.</p>
        </div>`,
      body,
    });

    const available = canInspect;
    const statusCode = !identity ? 401 : available ? 200 : 403;
    return reply
      .code(statusCode)
      .header("Cache-Control", "no-cache")
      .type("text/html; charset=utf-8")
      .send(html);
  });
}
