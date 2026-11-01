import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/web/public/roster.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");

test("initialization page uses verified operator preview", () => {
  assert.ok(page.includes("manualRosterInitializationPreview(identity.identityId)"));
  assert.ok(page.includes("roster_initialization_forbidden"));
  assert.ok(page.includes('preview.mode === "manual" && !preview.initialized'));
  assert.ok(server.includes("registerRosterMembersPage(app, webAssets)"));
});

test("selection posts reviewed version and IDs", () => {
  assert.ok(page.includes("data-roster-confirm"));
  assert.ok(client.includes("snapshot_version: root.dataset.snapshotVersion"));
  assert.ok(client.includes("selected_character_record_ids: selected"));
  assert.ok(client.includes("roster_snapshot_changed"));
});
