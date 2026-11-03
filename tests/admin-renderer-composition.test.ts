import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const renderer = readFileSync(new URL("../src/web/render.ts", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/web/pages/admin.ts", import.meta.url), "utf8");

test("administration sections use renderer-owned composition", () => {
  assert.match(renderer, /export function renderAdminSectionStack/);
  assert.match(renderer, /class="admin-sections"/);
  assert.match(admin, /renderAdminSectionStack\(articleSettings\)/);
  assert.match(admin, /renderAdminSectionStack\(themeSettings, presentationSettings, homepageSection\)/);
  assert.match(admin, /renderAdminSectionStack\(content\)/);
  assert.doesNotMatch(admin, /<div class="admin-sections">/);
});
