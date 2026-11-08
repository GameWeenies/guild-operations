import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEstablishRaidInput, validateSelectedConfiguration, rolesForParticipationSpecs } from "../src/activities/raid/domain.ts";

test("Raid establishment no longer requires guild or character eligibility", () => {
  assert.doesNotThrow(() => validateEstablishRaidInput({
    label: "Test raid", occursAt: [1_800_000_000], difficulty: "normal",
  }));
});

test("Raid assignments must match declared class and specialization", () => {
  const offers = [{ className: "Mage", specName: "Fire" }, { className: "Priest", specName: "Holy" }];
  assert.ok(rolesForParticipationSpecs(offers).includes("damage"));
  assert.ok(rolesForParticipationSpecs(offers).includes("healer"));
  assert.doesNotThrow(() => validateSelectedConfiguration(offers, "Mage", "Fire", "damage"));
  assert.throws(() => validateSelectedConfiguration(offers, "Mage", "Frost", "damage"), /not offered/);
  assert.throws(() => validateSelectedConfiguration(offers, "Priest", "Holy", "tank"), /not supported/);
});
