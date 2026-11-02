import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const transition = readFileSync(new URL("../src/core/guild/roster-mode-transitions.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/web/public/roster.js", import.meta.url), "utf8");

test("Blizzard Sync activation requires the operator's observed controlled Rank 0 character", () => {
  const gate = transition.indexOf("blizzard_sync_administrator_missing");
  const switchMode = transition.indexOf("mode = 'blizzard_sync'");
  assert.ok(gate >= 0 && gate < switchMode);
  assert.match(transition, /observed.currently_present = true/);
  assert.match(transition, /observed.rank_index = 0 AND control.identity_id = \$2/);
  assert.match(transition, /control.currently_controlled = true/);
  assert.match(ui, /blizzard_sync_administrator_missing/);
});
