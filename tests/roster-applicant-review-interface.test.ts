import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/web/public/roster.js", import.meta.url), "utf8");

test("applicant review is only rendered for initialized Manual roster", () => {
  assert.match(page, /const applicantReview = manualControls \?/);
  assert.match(page, /pendingRosterApplications\(identity\.identityId\)/);
  assert.match(page, /data-application-id/);
  assert.match(page, /data-application-rank/);
  assert.match(page, /data-application-approve/);
  assert.match(page, /data-application-reject/);
});
test("review uses existing approval and rejection routes", () => {
  assert.match(script, /\/guild\/roster\/applications\/\$\{encodeURIComponent\(row\.dataset\.applicationId\)\}/);
  assert.match(script, /rank_index: Number\(rank\.value\)/);
  assert.match(script, /window\.confirm\("Reject this guild roster application\?"\)/);
  assert.match(script, /window\.location\.reload\(\)/);
});
