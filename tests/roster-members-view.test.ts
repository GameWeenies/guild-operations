import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const projection = readFileSync(new URL("../src/core/guild/roster-members-view.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");

test("members view reads effective membership rather than directly selecting observed roster", () => {
  assert.match(projection, /effectiveGuildRosterSql/);
  assert.match(projection, /canManageGuildRoster/);
  assert.match(projection, /observed\.rank_index AS observed_rank/);
  assert.match(projection, /mode === "manual" && row\.observed_rank !== row\.rank_index/);
});
test("members page shows mode-aware effective roster with discrepancies only in Manual", () => {
  assert.match(page, /rosterMembersView\(identity\.identityId\)/);
  assert.match(page, /membersView\.members\.map/);
  assert.match(page, /member\.discrepancy/);
  assert.match(page, /Blizzard-observed membership is authoritative\. This roster is read-only/);
  assert.match(page, /\$\{membersTable\}\$\{applicantReview\}\$\{reconciliation\}/);
});
