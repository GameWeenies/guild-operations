import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");

test("uninitialized Manual roster routes verified GM to initialization without rank-gated reads", () => {
  const bootstrap = source.indexOf('if (bootstrap) {');
  const initialization = source.indexOf('manualRosterInitializationPreview(identity.identityId)', bootstrap);
  const response = source.indexOf('body: review,', bootstrap);
  const reconciliation = source.indexOf('rosterReconciliationPreview(identity.identityId)', bootstrap);
  const members = source.indexOf('rosterMembersView(identity.identityId)', bootstrap);
  assert.ok(bootstrap >= 0 && initialization > bootstrap && response > initialization);
  assert.ok(reconciliation > response && members > response);
  assert.match(source, /error: "roster_initialization_forbidden"/);
  assert.match(source, /state\.rows\[0\]\.mode === "manual" && !state\.rows\[0\]\.manual_initialized_at/);
});
