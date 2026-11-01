import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migration = await readFile(
  new URL("../sql/093_roster_management_foundation.sql", import.meta.url),
  "utf8",
);

test("declared roster and Blizzard observations have separate persistence", () => {
  assert.match(migration, /CREATE TABLE guild_declared_roster\s*\(/);
  assert.match(migration, /CREATE TABLE guild_roster_observation_state\s*\(/);
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+guild_roster\b/i);
  assert.doesNotMatch(migration, /INSERT INTO\s+guild_declared_roster\b/i);
});

test("Manual mode is the default and existing guilds require explicit initialization", () => {
  assert.match(migration, /mode text NOT NULL DEFAULT 'manual'/);
  assert.match(migration, /CHECK \(mode IN \('manual', 'blizzard_sync'\)\)/);
  assert.match(migration, /manual_initialized_at timestamptz/);
  assert.match(migration, /INSERT INTO guild_roster_management \(guild_id\)\s*SELECT guild_id FROM guilds/);
});

test("declared entries are constrained to a guild, character and configured rank", () => {
  assert.match(migration, /PRIMARY KEY \(guild_id, character_record_id\)/);
  assert.match(migration, /CHECK \(rank_index BETWEEN 0 AND 9\)/);
  assert.match(migration, /FOREIGN KEY \(guild_id, rank_index\)\s*REFERENCES guild_rank_definitions/);
});

test("snapshot provenance distinguishes acquisition from Blizzard source modification", () => {
  assert.match(migration, /acquired_at timestamptz NOT NULL/);
  assert.match(migration, /source_last_modified_at timestamptz/);
});
