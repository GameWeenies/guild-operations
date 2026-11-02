import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRosterEntries } from "../src/core/guild/roster-reconciliation.js";

test("reconciliation distinguishes missing membership and rank differences", () => {
  const differences = compareRosterEntries(
    new Map([["a", 0], ["b", 3], ["d", 2]]),
    new Map([["a", 0], ["b", 4], ["c", 1]]),
  );
  assert.deepEqual(differences, [
    { characterRecordId: "b", declaredRank: 3, observedRank: 4, kind: "rank_mismatch" },
    { characterRecordId: "c", declaredRank: null, observedRank: 1, kind: "observed_only" },
    { characterRecordId: "d", declaredRank: 2, observedRank: null, kind: "declared_only" },
  ]);
});
test("identical rosters have no discrepancies, including rank zero", () => {
  assert.deepEqual(compareRosterEntries(new Map([["a", 0]]), new Map([["a", 0]])), []);
});
