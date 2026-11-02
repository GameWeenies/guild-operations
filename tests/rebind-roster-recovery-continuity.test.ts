import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const rebind = readFileSync(new URL("../src/core/installation/rebinding.ts", import.meta.url), "utf8");

test("rebind persists the verified destination GM character rather than the old guild GM", () => {
  assert.match(rebind, /const verifiedGm = guildMasterCharacters\.find/);
  assert.match(rebind, /SELECT character_record_id FROM character_roster WHERE region = \$1 AND realm_id = \$2 AND character_id = \$3/);
  assert.match(rebind, /verified_gm_character_record_id=\$3/);
  assert.match(rebind, /\[destinationId, identityId, verifiedCharacter\.rows\[0\]\.character_record_id\]/);
});

test("rebind cancels previous guild pending recovery within its transaction", () => {
  assert.match(rebind, /UPDATE roster_recovery_requests SET cancelled_at = now\(\) WHERE guild_id = \$1/);
  assert.match(rebind, /\[binding\.guild_id\]/);
});
