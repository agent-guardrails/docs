import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AJV_VERSION,
  COMPATIBILITY_FIXTURE,
  FIXTURE_ROLES,
  MAX_FACTS_BYTES,
  MAX_FACTS_DEPTH,
  MAX_VERDICT_BYTES,
  aggregateVerdict,
  assertFixtureRoles,
  assertLegacyRejects,
  assertManifestMatchesDiscovered,
  compareUtf8Bytes,
  discoverFixtureFiles,
  jsonDepth,
  loadAjv,
  loadFixtureManifest,
  parseVerdictJson,
  schemaValidationErrors,
  selectFixturesForRole,
  selectTruncatedReasons,
  semanticValidationErrors,
} from "../validate-shell-warden-verdict-v2-fixtures.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FIXTURES_PATH = join(ROOT, "schemas/fixtures/shell-warden.verdict.v2");
const VALID_TUPLES = new Set([
  "static/argv/allow",
  "static/argv/ask",
  "static/argv/deny",
  "opaque/raw/ask",
  "opaque/raw/deny",
  "invalid/raw/ask",
  "invalid/raw/deny",
]);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function compileSchemas() {
  const [v2Schema, v1Schema] = await Promise.all([
    readJson(join(ROOT, "schemas/shell-warden.verdict.v2.schema.json")),
    readJson(join(ROOT, "schemas/shell-warden.verdict.v1.schema.json")),
  ]);
  const Ajv = loadAjv();
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
  return {
    v2Schema,
    validateV2: ajv.compile(v2Schema),
    validateV1: ajv.compile(v1Schema),
  };
}

function v2Document(classification, match, verdict) {
  const command = { index: 0, verdict, classification, match };
  if (verdict === "deny") {
    command.ruleId = "policy/deny";
  }
  const result = {
    invocationId: `test:${classification}-${match}-${verdict}`,
    verdict,
    commands: [command],
  };
  if (verdict === "deny") {
    result.message = "Denied by policy.";
  }
  return { protocol: "shell-warden.verdict.v2", result };
}

function indexedDocument(indexes) {
  return {
    protocol: "shell-warden.verdict.v2",
    result: {
      invocationId: "test:indexes",
      verdict: "ask",
      commands: indexes.map((index) => ({
        index,
        verdict: "ask",
        classification: "opaque",
        match: "raw",
      })),
    },
  };
}

function fullFacts(evidence, votes = [], matched = [], qualified = [], reasons = ["complete"]) {
  return {
    evidence,
    reasons,
    selectedProfiles: [],
    matched,
    qualified,
    rejected: [],
    votes,
  };
}

function errorsForCommand(command) {
  const document = {
    protocol: "shell-warden.verdict.v2",
    result: {
      invocationId: "test:diagnostics",
      verdict: command.verdict,
      ...(command.verdict === "deny" ? { message: "Denied." } : {}),
      commands: [command],
    },
  };
  return semanticErrors(document, [command.index]);
}

function semanticErrors(document, positionalIndexes, invocationId = document.result?.invocationId ?? document.invocationId) {
  return semanticValidationErrors(document, { invocationId, positionalIndexes });
}

function errorCodes(errors) {
  return errors.map((error) => error.code);
}

function jsonStringWithExactBytes(byteLength) {
  const prefix = '{"value":"';
  const suffix = '"}';
  const available = byteLength - Buffer.byteLength(prefix + suffix, "utf8");
  const emojiCount = Math.floor(available / 4);
  const asciiCount = available - emojiCount * 4;
  return `${prefix}${"😀".repeat(emojiCount)}${"a".repeat(asciiCount)}${suffix}`;
}

function factsWithExactBytes(byteLength) {
  const empty = { payload: "" };
  const overhead = Buffer.byteLength(JSON.stringify(empty), "utf8");
  const available = byteLength - overhead;
  const unicodeCount = Math.floor(available / 2);
  return { payload: `${"é".repeat(unicodeCount)}${"a".repeat(available - unicodeCount * 2)}` };
}

function nestedObject(depth) {
  let value = 0;
  for (let level = 0; level < depth; level += 1) {
    value = { value };
  }
  return value;
}

test("pins the required Ajv version and resource limits", () => {
  assert.equal(AJV_VERSION, "8.17.1");
  assert.equal(MAX_VERDICT_BYTES, 65_536);
  assert.equal(MAX_FACTS_BYTES, 16_384);
  assert.equal(MAX_FACTS_DEPTH, 8);
});

test("reduces command verdicts by deny then ask then allow", () => {
  assert.equal(aggregateVerdict(["allow"]), "allow");
  assert.equal(aggregateVerdict(["allow", "ask", "allow"]), "ask");
  assert.equal(aggregateVerdict(["ask", "deny", "allow"]), "deny");
  assert.throws(() => aggregateVerdict([]), /at least one command verdict/u);
  assert.throws(() => aggregateVerdict(["review"]), /unknown command verdict/u);
});

test("truncated reasons retain deterministic evidence anchors", () => {
  const coverageReasons = [
    "allow-coverage-missing",
    "allow-evidence-not-complete",
    "option-not-allowed",
    "option-not-repeatable",
    "option-value-position-uncovered",
    "option-value-uncovered",
    "redirect-policy-uncovered",
    "remainder-uncovered",
    "required-option-missing",
  ].sort(compareUtf8Bytes);
  const completeCoverageReasons = coverageReasons.filter((reason) => reason !== "allow-evidence-not-complete");
  const cases = [
    { evidence: "complete", anchor: "complete", remaining: completeCoverageReasons },
    { evidence: "opaque", anchor: "opaque-expansion", remaining: coverageReasons },
    { evidence: "invalid", anchor: "unsupported-syntax", remaining: coverageReasons },
  ];
  for (const { evidence, anchor, remaining } of cases) {
    const selected = selectTruncatedReasons(evidence, [...remaining, anchor]);
    const expected = [anchor, ...remaining.slice(0, 7)].sort(compareUtf8Bytes);
    assert.deepEqual(selected, expected, `${evidence} deterministic selection`);
    assert(selected.length <= 8, `${evidence} maximum`);
    assert.equal(new Set(selected).size, selected.length, `${evidence} unique`);
    assert.deepEqual(selected, [...selected].sort(compareUtf8Bytes), `${evidence} sorted`);
  }

  const multipleInvalidCauses = selectTruncatedReasons(
    "invalid",
    [...coverageReasons, "unknown-option", "unsupported-syntax"],
  );
  assert(multipleInvalidCauses.includes("unknown-option"));
  assert(!multipleInvalidCauses.includes("unsupported-syntax"));

  const unchanged = ["allow-coverage-missing", "complete", "required-option-missing"];
  assert.deepEqual(selectTruncatedReasons("complete", unchanged), unchanged);
  assert.throws(() => selectTruncatedReasons("complete", ["allow-coverage-missing"]), /complete reason anchor/u);
  assert.throws(() => selectTruncatedReasons("opaque", ["complete"]), /opaque-expansion reason anchor/u);
  assert.throws(() => selectTruncatedReasons("invalid", ["complete"]), /invalid-cause reason anchor/u);
});

test("manifest names every discovered fixture exactly", async () => {
  const [manifest, discovered] = await Promise.all([
    loadFixtureManifest(),
    discoverFixtureFiles(FIXTURES_PATH),
  ]);
  assert.doesNotThrow(() => assertManifestMatchesDiscovered(manifest, discovered));
  assert.equal(manifest.length, 49);
  assert.throws(
    () => assertManifestMatchesDiscovered(manifest.slice(1), discovered),
    /fixture manifest mismatch/u,
  );
  for (const fixture of manifest) {
    assert(["valid", "schema", "semantic"].includes(fixture.phase));
    assert(["v1", "v2"].includes(fixture.schemaVersion));
    assert.equal(typeof fixture.expectedInvocationId, "string");
    assert(Array.isArray(fixture.positionalIndexes));
    assert.equal(fixture.expectedError === null, fixture.phase === "valid");
    assert.doesNotThrow(() => assertFixtureRoles(fixture));
  }
});

test("fixture roles are closed, non-empty, sorted, unique, and phase-aware", () => {
  assert.deepEqual(FIXTURE_ROLES, ["checker-producer", "checker-serialization", "hook-consumer"]);
  const v2Valid = {
    path: "valid/example.json",
    schemaVersion: "v2",
    phase: "valid",
    roles: [...FIXTURE_ROLES],
  };
  assert.doesNotThrow(() => assertFixtureRoles(v2Valid));

  const malformedCases = [
    { name: "missing", fixture: { ...v2Valid, roles: undefined }, pattern: /roles must be an array/u },
    { name: "non-array", fixture: { ...v2Valid, roles: "hook-consumer" }, pattern: /roles must be an array/u },
    { name: "empty", fixture: { ...v2Valid, roles: [] }, pattern: /roles must not be empty/u },
    {
      name: "duplicate",
      fixture: { ...v2Valid, roles: ["checker-producer", "checker-producer", "checker-serialization", "hook-consumer"] },
      pattern: /roles must be sorted and unique/u,
    },
    {
      name: "unknown",
      fixture: { ...v2Valid, roles: ["checker-producer", "checker-serialization", "hook-consumer", "runtime"] },
      pattern: /unknown fixture role runtime/u,
    },
    {
      name: "unsorted",
      fixture: { ...v2Valid, roles: ["hook-consumer", "checker-producer", "checker-serialization"] },
      pattern: /roles must be sorted and unique/u,
    },
  ];
  for (const { name, fixture, pattern } of malformedCases) {
    assert.throws(() => assertFixtureRoles(fixture), pattern, name);
  }

  assert.throws(
    () => assertFixtureRoles({
      path: "valid/v1.json",
      schemaVersion: "v1",
      phase: "valid",
      roles: ["checker-producer", "hook-consumer"],
    }),
    /v1 fixtures must have exactly the hook-consumer role/u,
  );
  assert.throws(
    () => assertFixtureRoles({ ...v2Valid, phase: "schema", roles: [...FIXTURE_ROLES] }),
    /invalid roles for v2 schema fixture/u,
  );
  assert.throws(
    () => assertFixtureRoles({
      ...v2Valid,
      phase: "semantic",
      roles: ["checker-serialization", "hook-consumer"],
    }),
    /invalid roles for v2 semantic fixture/u,
  );
});

test("fixture selection filters known roles and preserves manifest order", () => {
  const fixtures = [
    { path: "valid/v1.json", roles: ["hook-consumer"] },
    { path: "invalid/schema.json", roles: ["checker-serialization", "hook-consumer"] },
    { path: "invalid/semantic.json", roles: ["checker-producer", "hook-consumer"] },
  ];
  assert.strictEqual(selectFixturesForRole(fixtures), fixtures);
  assert.deepEqual(
    selectFixturesForRole(fixtures, "checker-producer").map((fixture) => fixture.path),
    ["invalid/semantic.json"],
  );
  assert.deepEqual(
    selectFixturesForRole(fixtures, "checker-serialization").map((fixture) => fixture.path),
    ["invalid/schema.json"],
  );
  assert.deepEqual(
    selectFixturesForRole(fixtures, "hook-consumer").map((fixture) => fixture.path),
    fixtures.map((fixture) => fixture.path),
  );
  assert.throws(() => selectFixturesForRole(fixtures, "runtime"), /unknown fixture role runtime/u);
});

test("v2 RuleId exactly tracks config v2 Identifier and broad IDs remain v2-only", async () => {
  const [{ v2Schema, validateV2, validateV1 }, configSchema] = await Promise.all([
    compileSchemas(),
    readJson(join(ROOT, "schemas/shell-warden.config.v2.schema.json")),
  ]);
  assert.deepEqual(v2Schema.definitions.RuleId, configSchema.$defs.Identifier);
  assert.deepEqual(v2Schema.definitions.ProfileId, configSchema.$defs.Identifier);

  const broadRuleId = "Policy:Allow_Command#1";
  const v2 = v2Document("static", "argv", "allow");
  v2.result.commands[0].ruleId = broadRuleId;
  assert.equal(validateV2(v2), true);

  const v1 = {
    invocationId: "test:broad-v1-id",
    verdict: "allow",
    commands: [{
      index: 0,
      verdict: "allow",
      ruleId: broadRuleId,
      classification: "static",
      match: "argv",
    }],
  };
  assert.equal(validateV1(v1), false);
});

test("schema and semantic validation exercise all 18 command tuples", async () => {
  const { validateV2 } = await compileSchemas();
  for (const classification of ["static", "opaque", "invalid"]) {
    for (const match of ["argv", "raw"]) {
      for (const verdict of ["allow", "ask", "deny"]) {
        const tuple = `${classification}/${match}/${verdict}`;
        const document = v2Document(classification, match, verdict);
        assert.equal(validateV2(document), VALID_TUPLES.has(tuple), `schema ${tuple}`);
        const semanticCodes = errorCodes(semanticErrors(document, [0]));
        assert.equal(semanticCodes.includes("tuple.impossible"), !VALID_TUPLES.has(tuple), `semantic ${tuple}`);
      }
    }
  }
});

test("allow and ask messages stay optional while deny message and ruleId stay required", async () => {
  const { validateV2 } = await compileSchemas();
  for (const verdict of ["allow", "ask"]) {
    const document = v2Document("static", "argv", verdict);
    assert.equal(validateV2(document), true, `${verdict} without message`);
    document.result.message = `${verdict} explanation`;
    assert.equal(validateV2(document), true, `${verdict} with message`);
  }
  const missingMessage = v2Document("static", "argv", "deny");
  delete missingMessage.result.message;
  assert.equal(validateV2(missingMessage), false);
  const missingRuleId = v2Document("static", "argv", "deny");
  delete missingRuleId.result.commands[0].ruleId;
  assert.equal(validateV2(missingRuleId), false);
  const nonStringProtocol = v2Document("static", "argv", "allow");
  nonStringProtocol.protocol = 2;
  assert.equal(validateV2(nonStringProtocol), false);
});

test("schema errors preserve schemaPath and keyword parameters", async () => {
  const { validateV2 } = await compileSchemas();
  const document = v2Document("static", "argv", "allow");
  delete document.result.commands[0].classification;
  assert.equal(validateV2(document), false);
  const required = schemaValidationErrors(validateV2.errors).find(
    (error) => error.schemaPath === "#/required" &&
      error.params.missingProperty === "classification",
  );
  assert.deepEqual(required, {
    code: "schema.required",
    location: "/result/commands/0",
    message: "must have required property 'classification'",
    schemaPath: "#/required",
    params: { missingProperty: "classification" },
  });
});

test("command indexes preserve released positional letter semantics", () => {
  assert.deepEqual(semanticErrors(indexedDocument([0, 1, 2]), [0, 1, 2]), []);
  assert(errorCodes(semanticErrors(indexedDocument([0, 0]), [0, 1])).includes("indexes.duplicate"));
  assert(errorCodes(semanticErrors(indexedDocument([0, 2]), [0, 1, 2])).includes("indexes.missing"));
  assert(errorCodes(semanticErrors(indexedDocument([0, 2]), [0, 1])).includes("indexes.position"));
  assert(errorCodes(semanticErrors(indexedDocument([0, 2]), [0, 1])).includes("indexes.unexpected"));
  assert.throws(() => semanticErrors(indexedDocument([0]), [1]), /positional sequence/u);
  const v1NonPositional = indexedDocument([0, 2]).result;
  assert(errorCodes(semanticErrors(v1NonPositional, [0, 1])).includes("indexes.position"));

  assert(errorCodes(semanticErrors(indexedDocument([0]), [0], "test:foreign")).includes("invocation.mismatch"));
});

test("full diagnostics enforce vote, winner, evidence, and reason coherence", () => {
  const allow = {
    index: 0,
    verdict: "allow",
    ruleId: "allow/a",
    classification: "static",
    match: "argv",
    facts: fullFacts("complete", ["allow:allow/z", "allow:allow/a"], ["allow/a", "allow/z"], ["allow/a", "allow/z"]),
  };
  assert.deepEqual(errorsForCommand(allow), []);

  const contradictoryAllow = structuredClone(allow);
  contradictoryAllow.facts.votes = ["deny:allow/a"];
  assert(errorCodes(errorsForCommand(contradictoryAllow)).includes("votes.verdict_mismatch"));

  const unqualifiedAllow = structuredClone(allow);
  unqualifiedAllow.facts.qualified = [];
  assert(errorCodes(errorsForCommand(unqualifiedAllow)).includes("votes.allow_unqualified"));

  const qualifiedWithoutVote = structuredClone(allow);
  qualifiedWithoutVote.facts.qualified.push("allow/missing");
  qualifiedWithoutVote.facts.matched.push("allow/missing");
  assert(errorCodes(errorsForCommand(qualifiedWithoutVote)).includes("qualified.missing_vote"));

  const rejectedWithoutMatch = structuredClone(allow);
  rejectedWithoutMatch.facts.rejected = [{ ruleId: "allow/rejected", reasons: ["allow-coverage-missing"] }];
  assert(errorCodes(errorsForCommand(rejectedWithoutMatch)).includes("rejected.unmatched"));

  const unsortedRejectedReasons = structuredClone(allow);
  unsortedRejectedReasons.facts.rejected = [{
    ruleId: "allow/a",
    reasons: ["required-option-missing", "allow-coverage-missing"],
  }];
  assert(errorCodes(errorsForCommand(unsortedRejectedReasons)).includes("rejected.reasons_not_sorted_unique"));

  const duplicateRejectedRuleId = structuredClone(allow);
  duplicateRejectedRuleId.facts.rejected = [
    { ruleId: "allow/a", reasons: ["allow-coverage-missing"] },
    { reasons: ["allow-coverage-missing"], ruleId: "allow/a" },
  ];
  const duplicateRejectedCodes = errorCodes(errorsForCommand(duplicateRejectedRuleId));
  assert(duplicateRejectedCodes.includes("rejected.duplicate_rule_id"));
  assert(!duplicateRejectedCodes.includes("diagnostics.malformed"));

  const malformedRejected = structuredClone(allow);
  malformedRejected.facts.rejected = [{ ruleId: "allow/a", reasons: "allow-coverage-missing" }];
  assert.deepEqual(errorCodes(errorsForCommand(malformedRejected)), ["diagnostics.malformed"]);

  const unmatchedAllow = structuredClone(allow);
  unmatchedAllow.facts.matched = [];
  assert(errorCodes(errorsForCommand(unmatchedAllow)).includes("votes.unmatched"));

  const wrongWinner = structuredClone(allow);
  wrongWinner.ruleId = "allow/z";
  assert(errorCodes(errorsForCommand(wrongWinner)).includes("rule_id.winner_mismatch"));

  const bareAsk = {
    index: 0,
    verdict: "ask",
    classification: "opaque",
    match: "raw",
    facts: fullFacts("opaque", [], [], [], ["opaque-expansion"]),
  };
  assert.deepEqual(errorsForCommand(bareAsk), []);
  bareAsk.facts.votes = ["deny:deny/a"];
  bareAsk.facts.matched = ["deny/a"];
  assert(errorCodes(errorsForCommand(bareAsk)).includes("votes.verdict_mismatch"));

  const askFromAllow = structuredClone(bareAsk);
  askFromAllow.facts = fullFacts("opaque", ["allow:allow/a"], ["allow/a"], ["allow/a"], ["opaque-expansion"]);
  assert.deepEqual(errorsForCommand(askFromAllow), []);

  const askRuleWithoutVote = structuredClone(bareAsk);
  askRuleWithoutVote.facts = fullFacts("opaque", [], [], [], ["opaque-expansion"]);
  askRuleWithoutVote.ruleId = "ask/a";
  assert(errorCodes(errorsForCommand(askRuleWithoutVote)).includes("rule_id.unexpected"));

  const deny = {
    index: 0,
    verdict: "deny",
    ruleId: "deny/a",
    classification: "invalid",
    match: "raw",
    facts: fullFacts("invalid", ["deny:deny/a"], ["deny/a"], [], ["unknown-option"]),
  };
  assert.deepEqual(errorsForCommand(deny), []);
  deny.facts.votes = [];
  assert(errorCodes(errorsForCommand(deny)).includes("rule_id.unexpected"));

  const staticStructural = structuredClone(allow);
  staticStructural.facts.reasons = ["unknown-option"];
  assert(errorCodes(errorsForCommand(staticStructural)).includes("reasons.complete_required"));

  const evidenceMismatch = structuredClone(allow);
  evidenceMismatch.facts.evidence = "opaque";
  assert(errorCodes(errorsForCommand(evidenceMismatch)).includes("evidence.classification_mismatch"));

  const unsortedReasons = structuredClone(allow);
  unsortedReasons.facts.reasons = ["redirect-policy-uncovered", "complete"];
  assert(errorCodes(errorsForCommand(unsortedReasons)).includes("reasons.not_sorted_unique"));

  const unsortedMatched = structuredClone(allow);
  unsortedMatched.facts.matched = ["allow/z", "allow/a"];
  assert(errorCodes(errorsForCommand(unsortedMatched)).includes("matched.not_sorted_unique"));

  const privateUse = "allow/\uE000";
  const nonBmp = "allow/\u{10000}";
  assert(compareUtf8Bytes(privateUse, nonBmp) < 0);
  assert(privateUse > nonBmp);
  const byteOrderedWinner = structuredClone(allow);
  byteOrderedWinner.ruleId = privateUse;
  byteOrderedWinner.facts = fullFacts(
    "complete",
    [`allow:${nonBmp}`, `allow:${privateUse}`],
    [privateUse, nonBmp],
    [privateUse, nonBmp],
  );
  assert.deepEqual(errorsForCommand(byteOrderedWinner), []);
});

test("full diagnostics enforce allow votes and coherent ask rule IDs", () => {
  const cases = [
    {
      name: "static allow without an emitted allow vote",
      command: {
        index: 0,
        verdict: "allow",
        classification: "static",
        match: "argv",
        facts: fullFacts("complete"),
      },
      expectedCode: "votes.allow_required",
    },
    {
      name: "default ask without emitted votes or ruleId",
      command: {
        index: 0,
        verdict: "ask",
        classification: "opaque",
        match: "raw",
        facts: fullFacts("opaque", [], [], [], ["opaque-expansion"]),
      },
    },
    {
      name: "ask with only allow votes and no ruleId",
      command: {
        index: 0,
        verdict: "ask",
        classification: "static",
        match: "argv",
        facts: fullFacts("complete", ["allow:policy/allow"], ["policy/allow"], ["policy/allow"]),
      },
    },
    {
      name: "ask with emitted ask votes and deterministic ruleId",
      command: {
        index: 0,
        verdict: "ask",
        ruleId: "policy/a",
        classification: "static",
        match: "argv",
        facts: fullFacts("complete", ["ask:policy/z", "ask:policy/a"], ["policy/a", "policy/z"]),
      },
    },
    {
      name: "ask with emitted ask vote but no ruleId",
      command: {
        index: 0,
        verdict: "ask",
        classification: "static",
        match: "argv",
        facts: fullFacts("complete", ["ask:policy/ask"], ["policy/ask"]),
      },
      expectedCode: "rule_id.required",
    },
    {
      name: "ask with non-deterministic emitted winner",
      command: {
        index: 0,
        verdict: "ask",
        ruleId: "policy/z",
        classification: "static",
        match: "argv",
        facts: fullFacts("complete", ["ask:policy/z", "ask:policy/a"], ["policy/a", "policy/z"]),
      },
      expectedCode: "rule_id.winner_mismatch",
    },
    {
      name: "ask ruleId without an emitted ask vote",
      command: {
        index: 0,
        verdict: "ask",
        ruleId: "policy/ask",
        classification: "static",
        match: "argv",
        facts: fullFacts("complete", ["allow:policy/allow"], ["policy/allow"], ["policy/allow"]),
      },
      expectedCode: "rule_id.unexpected",
    },
  ];

  for (const { name, command, expectedCode } of cases) {
    const codes = errorCodes(errorsForCommand(command));
    if (expectedCode === undefined) {
      assert.deepEqual(codes, [], name);
    } else {
      assert(codes.includes(expectedCode), `${name}: ${JSON.stringify(codes)}`);
    }
  }
});

test("full and truncated diagnostics share evidence and reason compatibility", () => {
  const command = {
    index: 0,
    verdict: "ask",
    classification: "static",
    match: "argv",
    facts: {
      evidence: "complete",
      reasons: ["unknown-option"],
      diagnostics: "truncated-after-decision",
    },
  };
  let codes = errorCodes(errorsForCommand(command));
  assert(codes.includes("reasons.complete_required"));
  assert(codes.includes("reasons.complete_incompatible"));

  command.facts.reasons = ["allow-evidence-not-complete", "complete"];
  assert(errorCodes(errorsForCommand(command)).includes("reasons.complete_incompatible"));

  command.classification = "opaque";
  command.match = "raw";
  command.facts.evidence = "opaque";
  command.facts.reasons = ["unknown-option"];
  codes = errorCodes(errorsForCommand(command));
  assert(codes.includes("reasons.opaque_required"));
  assert(codes.includes("reasons.opaque_incompatible"));

  command.facts.reasons = ["complete", "opaque-expansion"];
  assert.deepEqual(errorsForCommand(command), []);

  command.classification = "invalid";
  command.facts.evidence = "invalid";
  command.facts.reasons = ["complete"];
  assert(errorCodes(errorsForCommand(command)).includes("reasons.invalid_required"));

  command.facts.reasons = ["unknown-option", "unknown-option"];
  assert(errorCodes(errorsForCommand(command)).includes("reasons.not_sorted_unique"));
});

test("v1 exact diagnostics are strict while disjoint legacy facts stay open", () => {
  const base = {
    invocationId: "test:v1-facts",
    verdict: "ask",
    commands: [{ index: 0, verdict: "ask", classification: "static", match: "argv" }],
  };
  base.commands[0].facts = fullFacts("complete");
  assert.deepEqual(semanticErrors(base, [0]), []);
  base.commands[0].facts.evidence = "opaque";
  base.commands[0].facts.reasons = ["opaque-expansion"];
  assert(errorCodes(semanticErrors(base, [0])).includes("evidence.classification_mismatch"));

  base.commands[0].facts = {
    evidence: "complete",
    reasons: ["unknown-option"],
    diagnostics: "truncated-after-decision",
  };
  assert(errorCodes(semanticErrors(base, [0])).includes("reasons.complete_required"));

  base.commands[0].classification = "opaque";
  base.commands[0].match = "raw";
  for (const [evidence, reasons] of [
    ["opaque", ["opaque-expansion"]],
    ["invalid", ["unknown-option"]],
  ]) {
    base.commands[0].facts = fullFacts(evidence, [], [], [], reasons);
    assert.deepEqual(semanticErrors(base, [0]), []);
    base.commands[0].facts = {
      evidence,
      reasons,
      diagnostics: "truncated-after-decision",
    };
    assert.deepEqual(semanticErrors(base, [0]), []);
  }
  base.commands[0].facts = fullFacts("complete");
  assert(errorCodes(semanticErrors(base, [0])).includes("evidence.classification_mismatch"));

  base.commands[0].facts = fullFacts(
    "opaque",
    ["allow:policy/allow"],
    ["policy/allow"],
    ["policy/allow"],
    ["opaque-expansion"],
  );
  let codes = errorCodes(semanticErrors(base, [0]));
  assert(!codes.includes("votes.verdict_mismatch"));
  assert(!codes.includes("rule_id.winner_mismatch"));

  base.commands[0].facts = fullFacts("opaque", [], [], [], ["opaque-expansion"]);
  base.commands[0].ruleId = "policy/ask";
  assert(errorCodes(semanticErrors(base, [0])).includes("rule_id.unexpected"));
  delete base.commands[0].ruleId;

  base.commands[0].facts = {
    evidence: "invalid",
    reasons: ["complete"],
    diagnostics: "truncated-after-decision",
  };
  codes = errorCodes(semanticErrors(base, [0]));
  assert(codes.includes("reasons.invalid_required"));

  base.commands[0].facts = { ...fullFacts("opaque"), reasons: "opaque-expansion" };
  assert(errorCodes(semanticErrors(base, [0])).includes("diagnostics.malformed"));
  base.commands[0].facts = {
    evidence: "opaque",
    reasons: ["opaque-expansion"],
    diagnostics: "truncated-before-decision",
  };
  assert(errorCodes(semanticErrors(base, [0])).includes("diagnostics.malformed"));

  base.commands[0].facts = { implementationSpecific: { anything: true } };
  assert.deepEqual(semanticErrors(base, [0]), []);

  const reservedKeyCases = [
    { name: "evidence only", facts: { evidence: "complete" } },
    { name: "full plus extra key", facts: { ...fullFacts("complete"), implementationSpecific: true } },
    {
      name: "truncated missing reasons",
      facts: { evidence: "opaque", diagnostics: "truncated-after-decision" },
    },
  ];
  for (const { name, facts } of reservedKeyCases) {
    base.commands[0].facts = facts;
    assert(errorCodes(semanticErrors(base, [0])).includes("diagnostics.malformed"), name);
  }
});

test("raw verdict byte cap is checked before parse with Unicode-aware boundaries", () => {
  const atLimit = jsonStringWithExactBytes(MAX_VERDICT_BYTES);
  assert.equal(Buffer.byteLength(atLimit, "utf8"), MAX_VERDICT_BYTES);
  assert.deepEqual(parseVerdictJson(atLimit).errors, []);
  const overLimit = jsonStringWithExactBytes(MAX_VERDICT_BYTES + 1);
  assert.equal(Buffer.byteLength(overLimit, "utf8"), MAX_VERDICT_BYTES + 1);
  assert.equal(parseVerdictJson(overLimit).errors[0].code, "resource.verdict_bytes");
});

test("facts enforce serialized UTF-8 byte and depth caps at exact boundaries", () => {
  const document = {
    invocationId: "test:v1-resources",
    verdict: "ask",
    commands: [{ index: 0, verdict: "ask", classification: "static", match: "argv" }],
  };
  document.commands[0].facts = factsWithExactBytes(MAX_FACTS_BYTES);
  assert.equal(Buffer.byteLength(JSON.stringify(document.commands[0].facts), "utf8"), MAX_FACTS_BYTES);
  assert(!errorCodes(semanticErrors(document, [0])).includes("resource.facts_bytes"));
  document.commands[0].facts = factsWithExactBytes(MAX_FACTS_BYTES + 1);
  assert(errorCodes(semanticErrors(document, [0])).includes("resource.facts_bytes"));

  document.commands[0].facts = nestedObject(MAX_FACTS_DEPTH);
  assert.equal(jsonDepth(document.commands[0].facts), MAX_FACTS_DEPTH);
  assert(!errorCodes(semanticErrors(document, [0])).includes("resource.facts_depth"));
  document.commands[0].facts = nestedObject(MAX_FACTS_DEPTH + 1);
  assert(errorCodes(semanticErrors(document, [0])).includes("resource.facts_depth"));

  document.commands[0].facts = nestedObject(50_000);
  assert.doesNotThrow(() => semanticErrors(document, [0]));
  assert(errorCodes(semanticErrors(document, [0])).includes("resource.facts_depth"));

  const cyclicFacts = {};
  cyclicFacts.self = cyclicFacts;
  document.commands[0].facts = cyclicFacts;
  assert(errorCodes(semanticErrors(document, [0])).includes("resource.facts_serialization"));
});

test("exact v1 schema accepts legacy evidence but semantic validation rejects malformed diagnostics", async () => {
  const [{ validateV1 }, compatibilityDocument, ...malformedDiagnostics] = await Promise.all([
    compileSchemas(),
    readJson(join(FIXTURES_PATH, COMPATIBILITY_FIXTURE)),
    readJson(join(FIXTURES_PATH, "invalid/v1-evidence-only-diagnostics.json")),
    readJson(join(FIXTURES_PATH, "invalid/v1-full-diagnostics-extra-key.json")),
    readJson(join(FIXTURES_PATH, "invalid/v1-malformed-full-diagnostics.json")),
    readJson(join(FIXTURES_PATH, "invalid/v1-malformed-truncated-diagnostics.json")),
    readJson(join(FIXTURES_PATH, "invalid/v1-truncated-diagnostics-missing-key.json")),
  ]);
  assert.doesNotThrow(() => assertLegacyRejects(validateV1, compatibilityDocument));
  for (const document of malformedDiagnostics) {
    assert.equal(validateV1(document), true);
    assert(errorCodes(semanticErrors(document, [0])).includes("diagnostics.malformed"));
  }

  const impossible = {
    invocationId: "test:v1-impossible",
    verdict: "allow",
    commands: [{ index: 0, verdict: "allow", classification: "opaque", match: "argv" }],
  };
  assert.equal(validateV1(impossible), true);
  assert(errorCodes(semanticErrors(impossible, [0])).includes("tuple.impossible"));

  for (const vector of [
    { verdict: "allow", classification: "static", match: "argv" },
    { verdict: "ask", classification: "opaque", match: "raw" },
    { verdict: "deny", classification: "opaque", match: "raw" },
  ]) {
    const command = { index: 0, ...vector };
    const document = { invocationId: `test:v1-${vector.verdict}`, verdict: vector.verdict, commands: [command] };
    if (vector.verdict === "deny") {
      command.ruleId = "policy/deny";
      document.message = "Denied by policy.";
    }
    assert.equal(validateV1(document), true);
    assert.deepEqual(semanticErrors(document, [0]), []);
  }
});
