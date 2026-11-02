import assert from "node:assert/strict";
import { test } from "node:test";
import { rosterDifferences } from "../src/core/guild/roster-reconciliation.js";

const row = (id: string, declared: number | null, observed: number | null) => ({
  character_record_id: id, name: id, realm: "aegwynn", level: 80,
  declared_rank_index: declared, observed_rank_index: observed,
});

test("reconciliation reports only membership and rank differences", () => {
  assert.deepEqual(rosterDifferences([
    row("same", 0, 0), row("manual", 2, null),
    row("blizzard", null, 3), row("rank", 1, 2),
  ]).map((difference) => [difference.characterRecordId, difference.kind]), [
    ["manual", "declared_only"], ["blizzard", "observed_only"], ["rank", "rank_mismatch"],
  ]);
});
