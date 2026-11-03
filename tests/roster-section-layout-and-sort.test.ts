import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const render = readFileSync(new URL("../src/web/render.ts", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../src/web/public/app.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/web/public/roster.js", import.meta.url), "utf8");

test("shared renderer owns stacked panel spacing", () => {
  assert.match(render, /export function renderPageSectionStack/);
  assert.match(render, /class="page-section-stack"/);
  assert.match(appCss, /\.page-section-stack\s*\{[^}]*display: grid;[^}]*gap: 1\.25rem/s);
  assert.match(page, /renderPageSectionStack\(membersTable, applicantReview\)/);
  assert.match(page, /renderPageSectionStack\(synchronization, observationControls, reconciliation, syncTransition\)/);
});

test("roster supports numeric rank and bidirectional character-name header sorting", () => {
  assert.match(page, /a\.rankIndex - b\.rankIndex/);
  assert.match(page, /data-rank-index="\$\{member\.rankIndex\}"/);
  assert.match(page, /data-character-name="\$\{name\}"/);
  assert.match(page, /renderSortableColumnHeader\("Character", "name"\)/);
  assert.match(page, /renderSortableColumnHeader\("Rank", "rank", true\)/);
  assert.match(page, /renderTableFrame\(/);
  assert.doesNotMatch(page, /data-roster-member-sort/);
  assert.match(script, /Number\(a\.dataset\.rankIndex\) - Number\(b\.dataset\.rankIndex\)/);
  assert.match(script, /body\.append\(\.\.\.rows\)/);
  assert.match(script, /ascending = !ascending/);
  assert.match(script, /aria-sort/);
});
