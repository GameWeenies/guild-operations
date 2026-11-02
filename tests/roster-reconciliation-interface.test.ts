import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/web/public/roster.js", import.meta.url), "utf8");

test("sync mode renders difference-only review and snapshot freshness", () => {
  assert.match(page, /comparison.mode === "blizzard_sync"/);
  assert.match(page, /comparison.differences.map/);
  assert.match(page, /observationAcquiredAt/);
  assert.match(page, /sourceLastModifiedAt/);
  assert.match(page, /data-reconciliation-confirm/);
});
test("reconciliation supports selecting all, none and stale-preview rejection", () => {
  assert.match(script, /data-reconciliation-all/);
  assert.match(script, /data-reconciliation-none/);
  assert.match(script, /selected_character_record_ids: selected/);
  assert.match(script, /snapshot_version: root.dataset.snapshotVersion/);
  assert.match(script, /roster_snapshot_changed/);
  assert.match(script, /window.confirm/);
});
