import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/web/public/admin.js", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/web/pages/admin.ts", import.meta.url), "utf8");

test("Roster shows observation and source freshness separately", () => {
  assert.match(page, /data-roster-observation/);
  assert.match(page, /comparison\.observationAcquiredAt/);
  assert.match(page, /comparison\.sourceLastModifiedAt/);
  assert.match(page, /Manual membership and ranks remain authoritative/);
  assert.match(page, /Blizzard Sync uses the observed roster/);
});
test("Refresh uses existing permission and guild endpoint", () => {
  assert.match(page, /identityHasGuildCapability\(identity\.identityId, GUILD_REFRESH_CAPABILITY\)/);
  assert.match(page, /renderGuildRefreshOperation\(refreshStatus, canRefresh\)/);
  assert.match(page, /scripts: \["roster\.js", "admin\.js"\]/);
  assert.match(admin, /export function renderGuildRefreshOperation/);
  assert.match(script, /fetch\("\/guild\/refresh"/);
  assert.match(script, /method: "POST"/);
  assert.match(script, /window\.location\.reload\(\)/);
});
