import assert from "node:assert/strict";
import test from "node:test";

import {
  AJV_VERSION,
  definitionName,
  expectedKeywords,
  fixtureValues,
} from "../validate-shell-warden-config-v2-fixtures.mjs";

test("pins the required Ajv version", () => {
  assert.equal(AJV_VERSION, "8.17.1");
});

test("uses the fixture parent directory as schema definition", () => {
  assert.equal(
    definitionName("valid/OptionValueCoverage/by-position.json"),
    "OptionValueCoverage",
  );
});

test("maps invalid fixture names to expected Ajv keyword classes", () => {
  assert.deepEqual(
    expectedKeywords("invalid/Config/unknown-key.json"),
    new Set(["additionalProperties"]),
  );
  assert.deepEqual(
    expectedKeywords("invalid/EnvironmentPolicy/missing-occurrence.json"),
    new Set(["required"]),
  );
});

test("validates each item in array fixture documents", () => {
  assert.deepEqual(fixtureValues([{ any: true }, { regex: "safe" }]), [
    { any: true },
    { regex: "safe" },
  ]);
  assert.deepEqual(fixtureValues({ none: true }), [{ none: true }]);
});
