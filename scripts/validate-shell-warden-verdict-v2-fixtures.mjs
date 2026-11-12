#!/usr/bin/env node

import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const AJV_VERSION = "8.17.1";
export const FIXTURE_ROLES = Object.freeze([
  "checker-producer",
  "checker-serialization",
  "hook-consumer",
]);
export const MAX_VERDICT_BYTES = 65_536;
export const MAX_FACTS_BYTES = 16_384;
export const MAX_FACTS_DEPTH = 8;

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_PATH = join(ROOT, "schemas/shell-warden.verdict.v2.schema.json");
const FIXTURES_PATH = join(ROOT, "schemas/fixtures/shell-warden.verdict.v2");
const MANIFEST_PATH = join(FIXTURES_PATH, "manifest.json");
const FULL_FACT_FIELDS = [
  "evidence",
  "reasons",
  "selectedProfiles",
  "matched",
  "qualified",
  "rejected",
  "votes",
];
const TRUNCATED_FACT_FIELDS = ["diagnostics", "evidence", "reasons"];
const RESERVED_DIAGNOSTIC_KEYS = new Set([
  "evidence",
  "reasons",
  "diagnostics",
  "selectedProfiles",
  "matched",
  "qualified",
  "rejected",
  "votes",
]);
const STABLE_REASONS = new Set([
  "complete",
  "opaque-expansion",
  "unknown-option",
  "option-value-missing",
  "invalid-inline-option",
  "unsupported-syntax",
  "empty-command",
  "evidence-limit",
  "allow-evidence-not-complete",
  "allow-coverage-missing",
  "required-option-missing",
  "option-not-repeatable",
  "option-not-allowed",
  "option-value-uncovered",
  "option-value-position-uncovered",
  "remainder-uncovered",
  "redirect-policy-uncovered",
]);
const INVALID_REASONS = new Set([
  "unknown-option",
  "option-value-missing",
  "invalid-inline-option",
  "unsupported-syntax",
  "empty-command",
  "evidence-limit",
]);
const VALID_COMMAND_TUPLES = new Set([
  "static/argv/allow",
  "static/argv/ask",
  "static/argv/deny",
  "opaque/raw/ask",
  "opaque/raw/deny",
  "invalid/raw/ask",
  "invalid/raw/deny",
]);
const VERDICT_RANK = new Map([
  ["allow", 0],
  ["ask", 1],
  ["deny", 2],
]);

function validationError(code, location, message) {
  return { code, location, message };
}

function hasExactFields(value, fields) {
  return Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
}

function diagnosticsShape(facts) {
  if (facts === null || typeof facts !== "object" || Array.isArray(facts)) {
    return undefined;
  }
  if (hasExactFields(facts, FULL_FACT_FIELDS)) {
    return "full";
  }
  if (hasExactFields(facts, TRUNCATED_FACT_FIELDS)) {
    return "truncated";
  }
  if (Object.keys(facts).some((key) => RESERVED_DIAGNOSTIC_KEYS.has(key))) {
    return "malformed";
  }
  return undefined;
}

function isUniqueArray(values) {
  return new Set(values).size === values.length;
}

function isIdentifier(value) {
  return typeof value === "string" && [...value].length >= 1 && [...value].length <= 128 && !/\s/u.test(value);
}

function isBoundedIdentifierArray(value, maximum, requireUnique = false) {
  return Array.isArray(value) && value.length <= maximum && value.every(isIdentifier) &&
    (!requireUnique || isUniqueArray(value));
}

function rejectedEntryIsStructurallyValid(rejected) {
  return rejected !== null && typeof rejected === "object" && !Array.isArray(rejected) &&
    hasExactFields(rejected, ["reasons", "ruleId"]) && isIdentifier(rejected.ruleId) &&
    Array.isArray(rejected.reasons) && rejected.reasons.length >= 1 && rejected.reasons.length <= 9 &&
    rejected.reasons.every((reason) => typeof reason === "string" &&
      STABLE_REASONS.has(reason) && reason !== "complete" && reason !== "opaque-expansion" &&
      !INVALID_REASONS.has(reason));
}

function diagnosticsMembersAreValid(facts, shape) {
  const maximumReasons = shape === "full" ? 17 : 8;
  if (!["complete", "opaque", "invalid"].includes(facts.evidence) ||
      !Array.isArray(facts.reasons) || facts.reasons.length > maximumReasons ||
      !facts.reasons.every((reason) => typeof reason === "string" && STABLE_REASONS.has(reason))) {
    return false;
  }
  if (shape === "truncated") {
    return facts.diagnostics === "truncated-after-decision";
  }
  return isBoundedIdentifierArray(facts.selectedProfiles, 1024) &&
    isBoundedIdentifierArray(facts.matched, 4096) &&
    isBoundedIdentifierArray(facts.qualified, 4096, true) &&
    Array.isArray(facts.rejected) && facts.rejected.length <= 4096 &&
    facts.rejected.every(rejectedEntryIsStructurallyValid) &&
    Array.isArray(facts.votes) && facts.votes.length <= 4096 &&
    facts.votes.every((vote) => typeof vote === "string" && /^(allow|ask|deny):\S{1,128}$/u.test(vote));
}

function parseVote(vote) {
  const separator = vote.indexOf(":");
  return { action: vote.slice(0, separator), ruleId: vote.slice(separator + 1) };
}

function commandLocation(commandPosition, suffix = "") {
  return `/result/commands/${commandPosition}${suffix}`;
}

export function aggregateVerdict(verdicts) {
  if (!Array.isArray(verdicts) || verdicts.length === 0) {
    throw new Error("at least one command verdict is required");
  }
  return verdicts.reduce((aggregate, verdict) => {
    if (!VERDICT_RANK.has(verdict)) {
      throw new Error(`unknown command verdict: ${String(verdict)}`);
    }
    return VERDICT_RANK.get(verdict) > VERDICT_RANK.get(aggregate) ? verdict : aggregate;
  }, "allow");
}

export function jsonDepth(value, stopAfter = Number.POSITIVE_INFINITY) {
  if (value === null || typeof value !== "object") {
    return 0;
  }
  const stack = [{ value, depth: 1 }];
  const visited = new WeakSet();
  let maximum = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.value === null || typeof current.value !== "object" || visited.has(current.value)) {
      continue;
    }
    visited.add(current.value);
    maximum = Math.max(maximum, current.depth);
    if (maximum > stopAfter) {
      return maximum;
    }
    for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value)) {
      if (child !== null && typeof child === "object") {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return maximum;
}

export function parseVerdictJson(rawText) {
  const byteLength = Buffer.byteLength(rawText, "utf8");
  if (byteLength > MAX_VERDICT_BYTES) {
    return {
      document: undefined,
      errors: [validationError(
        "resource.verdict_bytes",
        "/",
        `verdict is ${byteLength} UTF-8 bytes; maximum is ${MAX_VERDICT_BYTES}`,
      )],
    };
  }
  try {
    return { document: JSON.parse(rawText), errors: [] };
  } catch (error) {
    return {
      document: undefined,
      errors: [validationError("syntax.invalid_json", "/", error.message)],
    };
  }
}

export function aggregateConsistencyErrors(document) {
  const result = document?.result;
  if (!result || !Array.isArray(result.commands) || result.commands.length === 0) {
    return [validationError("commands.empty", "/result/commands", "commands must contain at least one command")];
  }
  const expected = aggregateVerdict(result.commands.map((command) => command.verdict));
  return result.verdict === expected
    ? []
    : [validationError(
        "aggregate.mismatch",
        "/result/verdict",
        `aggregate verdict is ${String(result.verdict)}; expected ${expected}`,
      )];
}

export function compareUtf8Bytes(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function selectTruncatedReasons(evidence, reasons) {
  if (!Array.isArray(reasons) || !reasons.every((reason) => typeof reason === "string")) {
    throw new TypeError("reasons must be an array of strings");
  }
  const canonicalReasons = [...new Set(reasons)].sort(compareUtf8Bytes);
  let anchor;
  if (evidence === "complete") {
    anchor = "complete";
  } else if (evidence === "opaque") {
    anchor = "opaque-expansion";
  } else if (evidence === "invalid") {
    anchor = canonicalReasons.filter((reason) => INVALID_REASONS.has(reason)).sort(compareUtf8Bytes)[0];
    if (anchor === undefined) {
      throw new Error("invalid evidence requires an invalid-cause reason anchor");
    }
  } else {
    throw new Error(`unsupported evidence value: ${String(evidence)}`);
  }
  if (!canonicalReasons.includes(anchor)) {
    throw new Error(`${evidence} evidence requires ${anchor} reason anchor`);
  }
  if (canonicalReasons.length <= 8) {
    return canonicalReasons;
  }
  return [anchor, ...canonicalReasons.filter((reason) => reason !== anchor).slice(0, 7)].sort(compareUtf8Bytes);
}

function isSortedUnique(values) {
  return values.every((value, index) => index === 0 || compareUtf8Bytes(values[index - 1], value) < 0);
}

function diagnosticsCoherenceErrors(command, commandPosition) {
  const facts = command.facts;
  const errors = [];
  const reasonLocation = commandLocation(commandPosition, "/facts/reasons");
  if (!isSortedUnique(facts.reasons)) {
    errors.push(validationError(
      "reasons.not_sorted_unique",
      reasonLocation,
      "diagnostic reasons must be sorted and deduplicated",
    ));
  }
  if (facts.evidence === "complete") {
    if (!facts.reasons.includes("complete")) {
      errors.push(validationError("reasons.complete_required", reasonLocation, "complete evidence requires complete reason"));
    }
    const incompatible = facts.reasons.filter(
      (reason) => reason === "opaque-expansion" || reason === "allow-evidence-not-complete" || INVALID_REASONS.has(reason),
    );
    if (incompatible.length > 0) {
      errors.push(validationError(
        "reasons.complete_incompatible",
        reasonLocation,
        `complete evidence has incompatible reasons: ${incompatible.join(", ")}`,
      ));
    }
  } else if (facts.evidence === "opaque") {
    if (!facts.reasons.includes("opaque-expansion")) {
      errors.push(validationError("reasons.opaque_required", reasonLocation, "opaque evidence requires opaque-expansion reason"));
    }
    const incompatible = facts.reasons.filter((reason) => INVALID_REASONS.has(reason));
    if (incompatible.length > 0) {
      errors.push(validationError(
        "reasons.opaque_incompatible",
        reasonLocation,
        `opaque evidence has incompatible reasons: ${incompatible.join(", ")}`,
      ));
    }
  } else if (facts.evidence === "invalid" && !facts.reasons.some((reason) => INVALID_REASONS.has(reason))) {
    errors.push(validationError(
      "reasons.invalid_required",
      reasonLocation,
      "invalid evidence requires at least one invalid cause",
    ));
  }

  const expectedEvidence = command.classification === "static" ? ["complete"] : [command.classification];
  if (!expectedEvidence.includes(facts.evidence)) {
    errors.push(validationError(
      "evidence.classification_mismatch",
      commandLocation(commandPosition, "/facts/evidence"),
      `evidence ${String(facts.evidence)} does not match classification ${String(command.classification)}`,
    ));
  }
  return errors;
}

function fullDiagnosticsErrors(command, commandPosition) {
  const facts = command.facts;
  const errors = [];
  const votes = facts.votes.map(parseVote);
  const matched = new Set(facts.matched);
  const qualified = new Set(facts.qualified);

  if (command.classification === "static" && command.match === "argv" && command.verdict === "allow" &&
      !votes.some((vote) => vote.action === "allow")) {
    errors.push(validationError(
      "votes.allow_required",
      commandLocation(commandPosition, "/facts/votes"),
      "full static allow diagnostics require an emitted allow vote",
    ));
  }

  if (!isSortedUnique(facts.matched)) {
    errors.push(validationError(
      "matched.not_sorted_unique",
      commandLocation(commandPosition, "/facts/matched"),
      "matched rule IDs must be sorted and deduplicated",
    ));
  }

  for (const [rejectedPosition, rejected] of facts.rejected.entries()) {
    if (!isSortedUnique(rejected.reasons)) {
      errors.push(validationError(
        "rejected.reasons_not_sorted_unique",
        commandLocation(commandPosition, `/facts/rejected/${rejectedPosition}/reasons`),
        "rejected reasons must be sorted and deduplicated",
      ));
    }
  }
  const rejectedRuleIds = facts.rejected.map((rejected) => rejected.ruleId);
  const duplicateRejectedRuleIds = [...new Set(
    rejectedRuleIds.filter((ruleId, position) => rejectedRuleIds.indexOf(ruleId) !== position),
  )].sort(compareUtf8Bytes);
  if (duplicateRejectedRuleIds.length > 0) {
    errors.push(validationError(
      "rejected.duplicate_rule_id",
      commandLocation(commandPosition, "/facts/rejected"),
      `duplicate rejected rule IDs: ${duplicateRejectedRuleIds.join(", ")}`,
    ));
  }

  for (const vote of votes) {
    if (!VERDICT_RANK.has(vote.action) || vote.ruleId.length === 0) {
      errors.push(validationError(
        "votes.invalid",
        commandLocation(commandPosition, "/facts/votes"),
        `vote ${vote.action}:${vote.ruleId} has an invalid action or rule id`,
      ));
    }
  }

  for (const ruleId of qualified) {
    if (!matched.has(ruleId)) {
      errors.push(validationError(
        "qualified.unmatched",
        commandLocation(commandPosition, "/facts/qualified"),
        `qualified rule ${String(ruleId)} is not matched`,
      ));
    }
    if (!votes.some((vote) => vote.action === "allow" && vote.ruleId === ruleId)) {
      errors.push(validationError(
        "qualified.missing_vote",
        commandLocation(commandPosition, "/facts/qualified"),
        `qualified rule ${String(ruleId)} has no allow vote`,
      ));
    }
  }

  for (const rejected of facts.rejected) {
    const ruleId = rejected !== null && typeof rejected === "object" ? rejected.ruleId : undefined;
    if (typeof ruleId !== "string" || !matched.has(ruleId)) {
      errors.push(validationError(
        "rejected.unmatched",
        commandLocation(commandPosition, "/facts/rejected"),
        `rejected allow rule ${String(ruleId)} is not matched`,
      ));
    }
  }

  for (const vote of votes) {
    if (!matched.has(vote.ruleId)) {
      errors.push(validationError(
        "votes.unmatched",
        commandLocation(commandPosition, "/facts/votes"),
        `vote ${vote.action}:${vote.ruleId} does not identify a matched rule`,
      ));
    }
    if (vote.action === "allow" && !qualified.has(vote.ruleId)) {
      errors.push(validationError(
        "votes.allow_unqualified",
        commandLocation(commandPosition, "/facts/votes"),
        `allow vote ${vote.ruleId} does not identify a qualified rule`,
      ));
    }
  }

  const voteActions = votes.filter((vote) => VERDICT_RANK.has(vote.action)).map((vote) => vote.action);
  const strongestEmittedVerdict = voteActions.length === 0 ? undefined : aggregateVerdict(voteActions);
  if (strongestEmittedVerdict !== undefined &&
      VERDICT_RANK.get(command.verdict) < VERDICT_RANK.get(strongestEmittedVerdict)) {
    errors.push(validationError(
      "votes.verdict_mismatch",
      commandLocation(commandPosition, "/facts/votes"),
      `command verdict is ${command.verdict}; emitted votes require at least ${strongestEmittedVerdict}`,
    ));
  }

  const winningRuleIds = votes
    .filter((vote) => vote.action === command.verdict)
    .map((vote) => vote.ruleId)
    .sort(compareUtf8Bytes);
  if (winningRuleIds.length > 0 && command.ruleId === undefined) {
    errors.push(validationError(
      "rule_id.required",
      commandLocation(commandPosition, "/ruleId"),
      `ruleId must equal the UTF-8 byte-order smallest winning rule ${winningRuleIds[0]}`,
    ));
  } else if (winningRuleIds.length > 0 && command.ruleId !== winningRuleIds[0]) {
    errors.push(validationError(
      "rule_id.winner_mismatch",
      commandLocation(commandPosition, "/ruleId"),
      `ruleId must equal the UTF-8 byte-order smallest winning rule ${winningRuleIds[0]}`,
    ));
  } else if (winningRuleIds.length === 0 && command.ruleId !== undefined) {
    errors.push(validationError(
      "rule_id.unexpected",
      commandLocation(commandPosition, "/ruleId"),
      "ruleId must be absent when there is no winning vote",
    ));
  }
  return errors;
}

export function semanticValidationErrors(document, expectedContext) {
  const result = document?.result;
  if (!result || !Array.isArray(result.commands) || result.commands.length === 0) {
    return [validationError("commands.empty", "/result/commands", "commands must contain at least one command")];
  }
  const positionalIndexes = expectedContext?.positionalIndexes;
  if (typeof expectedContext?.invocationId !== "string" || expectedContext.invocationId.length === 0) {
    throw new Error("expectedContext.invocationId must be a non-empty string");
  }
  if (!Array.isArray(positionalIndexes) ||
      positionalIndexes.some((index) => !Number.isInteger(index) || index < 0) ||
      positionalIndexes.some((index, position) => index !== position)) {
    throw new Error("expectedContext.positionalIndexes must be the positional sequence 0..N-1");
  }

  const errors = aggregateConsistencyErrors(document);
  if (result.invocationId !== expectedContext.invocationId) {
    errors.push(validationError(
      "invocation.mismatch",
      "/result/invocationId",
      `invocationId is ${String(result.invocationId)}; expected ${expectedContext.invocationId}`,
    ));
  }
  for (const [commandPosition, command] of result.commands.entries()) {
    const tuple = `${String(command.classification)}/${String(command.match)}/${String(command.verdict)}`;
    if (!VALID_COMMAND_TUPLES.has(tuple)) {
      errors.push(validationError(
        "tuple.impossible",
        commandLocation(commandPosition),
        `command has impossible tuple ${tuple}`,
      ));
    }
    if (command.facts !== undefined) {
      const factsDepth = jsonDepth(command.facts, MAX_FACTS_DEPTH);
      if (factsDepth > MAX_FACTS_DEPTH) {
        errors.push(validationError(
          "resource.facts_depth",
          commandLocation(commandPosition, "/facts"),
          `facts depth is ${factsDepth}; maximum is ${MAX_FACTS_DEPTH}`,
        ));
      } else {
        try {
          const serializedFacts = JSON.stringify(command.facts);
          if (serializedFacts === undefined) {
            throw new TypeError("facts are not JSON-serializable");
          }
          const factsBytes = Buffer.byteLength(serializedFacts, "utf8");
          if (factsBytes > MAX_FACTS_BYTES) {
            errors.push(validationError(
              "resource.facts_bytes",
              commandLocation(commandPosition, "/facts"),
              `facts are ${factsBytes} UTF-8 bytes; maximum is ${MAX_FACTS_BYTES}`,
            ));
          }
        } catch (error) {
          errors.push(validationError(
            "resource.facts_serialization",
            commandLocation(commandPosition, "/facts"),
            `facts serialization failed: ${error.message}`,
          ));
        }
      }
      const shape = diagnosticsShape(command.facts);
      if (shape !== undefined) {
        if (shape === "malformed" || !diagnosticsMembersAreValid(command.facts, shape)) {
          errors.push(validationError(
            "diagnostics.malformed",
            commandLocation(commandPosition, "/facts"),
            shape === "malformed"
              ? "facts containing reserved diagnostic keys must use exactly the full or truncated key set"
              : `${shape} diagnostics contain malformed member values`,
          ));
        } else {
          errors.push(...diagnosticsCoherenceErrors(command, commandPosition));
          if (shape === "full") {
            errors.push(...fullDiagnosticsErrors(command, commandPosition));
          }
        }
      }
    }
  }

  const indexes = result.commands.map((command) => command.index);
  for (const [position, index] of indexes.entries()) {
    if (index !== position) {
      errors.push(validationError(
        "indexes.position",
        commandLocation(position, "/index"),
        `command at position ${position} has index ${String(index)}`,
      ));
    }
  }
  const duplicateIndexes = [...new Set(indexes.filter((index, position) => indexes.indexOf(index) !== position))]
    .sort((left, right) => left - right);
  if (duplicateIndexes.length > 0) {
    errors.push(validationError(
      "indexes.duplicate",
      "/result/commands",
      `duplicate command indexes: ${duplicateIndexes.join(", ")}`,
    ));
  }
  const expected = new Set(positionalIndexes);
  const actual = new Set(indexes);
  const missing = positionalIndexes.filter((index) => !actual.has(index)).sort((left, right) => left - right);
  const unexpected = [...actual].filter((index) => !expected.has(index)).sort((left, right) => left - right);
  if (missing.length > 0) {
    errors.push(validationError("indexes.missing", "/result/commands", `missing command indexes: ${missing.join(", ")}`));
  }
  if (unexpected.length > 0) {
    errors.push(validationError(
      "indexes.unexpected",
      "/result/commands",
      `unexpected command indexes: ${unexpected.join(", ")}`,
    ));
  }
  return errors;
}

export async function discoverFixtureFiles(fixturesPath = FIXTURES_PATH) {
  const fixtures = [];
  for (const kind of ["valid", "invalid"]) {
    const kindPath = join(fixturesPath, kind);
    const names = (await readdir(kindPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const filePath = join(kindPath, name);
      fixtures.push({
        filePath,
        fixturePath: relative(fixturesPath, filePath).split(sep).join("/"),
      });
    }
  }
  return fixtures;
}

export async function loadFixtureManifest(manifestPath = MANIFEST_PATH) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.fixtures)) {
    throw new Error("fixture manifest must contain a fixtures array");
  }
  const paths = manifest.fixtures.map((fixture) => fixture.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error("fixture manifest contains duplicate paths");
  }
  for (const fixture of manifest.fixtures) {
    assertFixtureRoles(fixture);
  }
  return manifest.fixtures;
}

export function assertFixtureRoles(fixture) {
  const fixtureName = typeof fixture?.path === "string" ? fixture.path : "fixture";
  if (!Array.isArray(fixture?.roles)) {
    throw new Error(`${fixtureName} roles must be an array`);
  }
  if (fixture.roles.length === 0) {
    throw new Error(`${fixtureName} roles must not be empty`);
  }
  const unknownRole = fixture.roles.find((role) => !FIXTURE_ROLES.includes(role));
  if (unknownRole !== undefined) {
    throw new Error(`${fixtureName} has unknown fixture role ${String(unknownRole)}`);
  }
  if (!isSortedUnique(fixture.roles)) {
    throw new Error(`${fixtureName} roles must be sorted and unique`);
  }

  const expectedRoles = fixture.phase === "valid"
    ? FIXTURE_ROLES
    : fixture.phase === "schema"
      ? ["checker-serialization", "hook-consumer"]
      : fixture.phase === "semantic"
        ? ["checker-producer", "hook-consumer"]
        : fixture.phase === "consumer-rejection"
          ? ["hook-consumer"]
          : undefined;
  if (fixture.schemaVersion !== "v2" || expectedRoles === undefined ||
      fixture.roles.length !== expectedRoles.length ||
      fixture.roles.some((role, index) => role !== expectedRoles[index])) {
    throw new Error(
      `${fixtureName} has invalid roles for ${String(fixture.schemaVersion)} ${String(fixture.phase)} fixture`,
    );
  }
}

export function selectFixturesForRole(fixtures, role) {
  if (role === undefined) {
    return fixtures;
  }
  if (!FIXTURE_ROLES.includes(role)) {
    throw new Error(`unknown fixture role ${String(role)}`);
  }
  return fixtures.filter((fixture) => fixture.roles.includes(role));
}

function parseCliRole(arguments_) {
  if (arguments_.length === 0) {
    return undefined;
  }
  if (arguments_.length !== 2 || arguments_[0] !== "--role") {
    throw new Error("usage: validate-shell-warden-verdict-v2-fixtures.mjs [--role <known-role>]");
  }
  const role = arguments_[1];
  if (!FIXTURE_ROLES.includes(role)) {
    throw new Error(`unknown fixture role ${String(role)}`);
  }
  return role;
}

export function assertManifestMatchesDiscovered(manifest, discovered) {
  const manifestPaths = manifest.map((fixture) => fixture.path).sort();
  const discoveredPaths = discovered.map((fixture) => fixture.fixturePath).sort();
  if (JSON.stringify(manifestPaths) !== JSON.stringify(discoveredPaths)) {
    throw new Error(
      `fixture manifest mismatch: manifest=${JSON.stringify(manifestPaths)} discovered=${JSON.stringify(discoveredPaths)}`,
    );
  }
}

export function loadAjv() {
  const require = createRequire(import.meta.url);
  const installedVersion = require("ajv/package.json").version;
  if (installedVersion !== AJV_VERSION) {
    throw new Error(`Ajv ${AJV_VERSION} required, found ${installedVersion}`);
  }
  return require("ajv").default;
}

export function schemaValidationErrors(errors) {
  return (errors ?? []).map((error) => ({
    ...validationError(`schema.${error.keyword}`, error.instancePath || "/", error.message),
    schemaPath: error.schemaPath,
    params: error.params,
  }));
}

function hasExpectedError(errors, expectedError) {
  return errors.some((error) =>
    Object.entries(expectedError).every(([key, value]) =>
      key === "params"
        ? Object.entries(value).every(([param, paramValue]) => error.params?.[param] === paramValue)
        : error[key] === value,
    ));
}

export async function main(arguments_ = process.argv.slice(2)) {
  const role = parseCliRole(arguments_);
  const [schemaText, manifest, discovered] = await Promise.all([
    readFile(SCHEMA_PATH, "utf8"),
    loadFixtureManifest(),
    discoverFixtureFiles(),
  ]);
  assertManifestMatchesDiscovered(manifest, discovered);
  const selectedManifest = selectFixturesForRole(manifest, role);
  const discoveredByPath = new Map(discovered.map((fixture) => [fixture.fixturePath, fixture]));
  const Ajv = loadAjv();
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
  const validateV2 = ajv.compile(JSON.parse(schemaText));
  const failures = [];

  for (const expectation of selectedManifest) {
    const fixture = discoveredByPath.get(expectation.path);
    const parsed = parseVerdictJson(await readFile(fixture.filePath, "utf8"));
    if (parsed.errors.length > 0) {
      failures.push(`${expectation.path} rejected before schema validation: ${JSON.stringify(parsed.errors)}`);
      continue;
    }
    const document = parsed.document;
    const schemaValid = validateV2(document);
    const schemaErrors = schemaValidationErrors(validateV2.errors);

    if (expectation.phase === "schema" || expectation.phase === "consumer-rejection") {
      if (schemaValid || !hasExpectedError(schemaErrors, expectation.expectedError)) {
        failures.push(`${expectation.path} schema result did not contain ${JSON.stringify(expectation.expectedError)}: ${JSON.stringify(schemaErrors)}`);
      }
      continue;
    }
    if (!schemaValid) {
      failures.push(`${expectation.path} unexpectedly failed schema validation: ${JSON.stringify(schemaErrors)}`);
      continue;
    }
    const semanticErrors = semanticValidationErrors(document, {
      invocationId: expectation.expectedInvocationId,
      positionalIndexes: expectation.positionalIndexes,
    });
    if (expectation.phase === "semantic") {
      if (!hasExpectedError(semanticErrors, expectation.expectedError)) {
        failures.push(`${expectation.path} semantic result did not contain ${JSON.stringify(expectation.expectedError)}: ${JSON.stringify(semanticErrors)}`);
      }
      continue;
    }
    if (expectation.phase !== "valid") {
      failures.push(`${expectation.path} has unknown manifest phase ${String(expectation.phase)}`);
    } else if (semanticErrors.length > 0) {
      failures.push(`${expectation.path} unexpectedly failed semantic validation: ${JSON.stringify(semanticErrors)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`fixture validation failed:\n${failures.join("\n")}`);
  }
  const counts = Object.groupBy(selectedManifest, (fixture) => fixture.phase);
  const selection = role === undefined ? "" : ` for role ${role}`;
  console.log(
    `validated ${selectedManifest.length} manifest-pinned shell-warden verdict fixtures${selection} against the v2 schema ` +
      `(${counts.valid?.length ?? 0} valid, ${counts.schema?.length ?? 0} schema-invalid, ` +
      `${counts.semantic?.length ?? 0} semantic-invalid, ` +
      `${counts["consumer-rejection"]?.length ?? 0} consumer-rejected) with Ajv ${AJV_VERSION}`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
