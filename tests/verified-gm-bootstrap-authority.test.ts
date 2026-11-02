import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const binding = readFileSync(new URL("../src/core/installation/guild-binding.ts", import.meta.url), "utf8");
const initialization = readFileSync(new URL("../src/core/guild/roster-initialization-operation.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../sql/095_verified_gm_bootstrap_character.sql", import.meta.url), "utf8");

test("installation verification retains the observed rank-zero character", () => {
  assert.match(binding, /verified_gm_character_record_id = \$3/);
  assert.match(binding, /rankIndex === 0 \? rankResult\.rows\[0\]\.character_record_id/);
  assert.match(migration, /ADD COLUMN verified_gm_character_record_id uuid/);
});

test("reviewed initialization seeds controlled GM rank zero atomically", () => {
  assert.match(initialization, /authorization_kind = 'guild_master'/);
  assert.match(initialization, /currently_controlled = true/);
  assert.match(initialization, /initializeManualRosterFromReviewedSnapshot\(client, guildId, selectedCharacterRecordIds\)/);
  assert.match(initialization, /INSERT INTO guild_declared_roster \(guild_id, character_record_id, rank_index\)/);
  assert.match(initialization, /VALUES \(\$1, \$2, 0\) ON CONFLICT/);
  assert.match(page, /included as Rank 0 regardless of this selection/);
});
