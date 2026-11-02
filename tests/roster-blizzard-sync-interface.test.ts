import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/web/public/roster.js", import.meta.url), "utf8");

test("Manual roster alone offers a staleness-acknowledged Sync switch", () => {
  assert.match(page, /const syncTransition = manualControls \?/);
  assert.match(page, /data-roster-blizzard-sync/);
  assert.match(page, /data-blizzard-sync-acknowledge/);
  assert.match(page, /data-blizzard-sync-commit disabled/);
  assert.match(page, /comparison\.observationAcquiredAt/);
  assert.match(page, /comparison\.sourceLastModifiedAt/);
});
test("Sync transition requires explicit checkbox and confirmation", () => {
  assert.match(script, /if \(!acknowledge\.checked \|\| commit\.disabled\) return/);
  assert.match(script, /window\.confirm\("Switch to Blizzard Sync/);
  assert.match(script, /fetch\("\/guild\/roster\/mode\/blizzard-sync"/);
  assert.match(script, /acknowledge_stale_roster_risk: true/);
  assert.match(script, /window\.location\.reload\(\)/);
});
