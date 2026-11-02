import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const render = readFileSync(new URL("../src/web/render.ts", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/web/pages/admin.ts", import.meta.url), "utf8");
const roster = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");

test("Roster is the second Guild Settings tab, not a public navigation destination", () => {
  assert.match(render, /label: "General", href: "\/admin\/general"[^]*label: "Roster", href: "\/admin\/roster\/members"[^]*label: "Appearance"/);
  assert.doesNotMatch(render, /href="\/roster\/members"/);
  assert.match(render, /pathname\.startsWith\("\/admin\/roster\/"\)/);
});

test("Roster pages share the settings shell and retain legacy redirects", () => {
  assert.match(roster, /app\.get\("\/admin\/roster\/members"/);
  assert.match(admin, /app\.get\("\/admin\/roster\/ranks"/);
  assert.match(roster, /app\.get\("\/roster\/members"[^\n]*redirect\("\/admin\/roster\/members"\)/);
  assert.match(admin, /app\.get\("\/roster\/ranks"[^\n]*redirect\("\/admin\/roster\/ranks"\)/);
  assert.match(roster, /renderGuildSettingsHeader\("Roster"/);
  assert.match(admin, /renderGuildSettingsHeader\("Roster"/);
});

test("Synchronization is on Roster Members and not General", () => {
  assert.match(roster, /const synchronization =/);
  assert.match(roster, /renderGuildRefreshSchedule\(refreshSchedule\)/);
  assert.match(roster, /renderGuildRefreshOperation\(refreshStatus, canRefresh\)/);
  assert.match(roster, /scripts: \["roster\.js", "admin\.js"\]/);
  const general = admin.slice(admin.indexOf('app.get("/admin/general"'), admin.indexOf('app.get("/admin/appearance"'));
  assert.doesNotMatch(general, /Guild synchronization|renderGuildRefreshSchedule|renderGuildRefreshOperation/);
});
