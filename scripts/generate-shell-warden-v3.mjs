#!/usr/bin/env node
// Deterministic v3 schemas and fixtures derived from immutable v2 provenance.
// No runtime reader uses the historical contract.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes("--check");
const mirrorArgs = process.argv.filter((a) => a.startsWith("--mirror="));
const mirrors = mirrorArgs.map((a) => path.resolve(a.slice("--mirror=".length)));
const configMirrors = process.argv.filter((a) => a.startsWith("--config-mirror="))
  .map((a) => path.resolve(a.slice("--config-mirror=".length)));
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
let files = 0;
function emit(relative, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  const destination = path.join(root, relative);
  if (check) {
    if (!fs.existsSync(destination) || fs.readFileSync(destination, "utf8") !== text) {
      throw new Error(`generated artifact differs: ${relative}`);
    }
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
  files++;
  const verdictPrefix = "schemas/fixtures/shell-warden.verdict.v3/";
  const configPrefix = "schemas/fixtures/shell-warden.config.v3/";
  if (relative.startsWith(verdictPrefix) || relative.startsWith(configPrefix)) {
    const isVerdict = relative.startsWith(verdictPrefix);
    const suffix = relative.slice((isVerdict ? verdictPrefix : configPrefix).length);
    for (const mirror of isVerdict ? mirrors : configMirrors) {
      const target = path.join(mirror, suffix);
      if (check) {
        if (fs.readFileSync(target, "utf8") !== text) throw new Error(`fixture mirror differs: ${target}`);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
      }
    }
  }
}

const config = read("schemas/shell-warden.config.v2.schema.json");
config.$id = config.$id.replace(".v2.", ".v3.");
config.title = "Shell Warden configuration v3";
config.$comment = "Active contextual parameter contract. v2 is historical; no compatibility reader.";
const d = config.$defs;
d.Config.properties.version.const = 3;
d.ExecutableSpelling = {
  type: "string", minLength: 1, maxLength: 4096,
  pattern: "^(?:[^/\\u0000-\\u001f\\u007f]+|/(?:[^/\\u0000-\\u001f\\u007f]+/)*[^/\\u0000-\\u001f\\u007f]+)$",
  not: { pattern: "[\\u0000-\\u001f\\u007f]|(?:^|/)\\.\\.?(?:/|$)" },
  $comment: "Exact bare name or normalized absolute POSIX spelling; never expanded or normalized. Semantic validation also enforces 4096 UTF-8 bytes, a singleton distinct-basename set or exactly one complete catalog group (node/nodejs or python/python3), unique full-spelling ownership across assembled files, analyzer compatibility for every basename, and bare-only export bindings (ADR 0025).",
};
d.Profile.properties.executables.items = { $ref: "#/$defs/ExecutableSpelling" };
d.VariableName = { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" };
d.VariableNames = { type: "array", maxItems: 64, uniqueItems: true, items: { $ref: "#/$defs/VariableName" } };
d.ExpansionPermissions = {
  type: "object",
  description: "Rule-local context grants do not authorize dynamic executable or code operands. Known wrapper/interpreter blocking uses literal basenames, including path spellings. Nonliteral awk operands remain opaque without a program-role analyzer, even after --. See spec/shell-warden/12-contextual-parameters.md.",
  additionalProperties: false,
  properties: Object.fromEntries(["arguments", "redirectTargets", "assignmentValues"].map((name) => [
    name, { $ref: "#/$defs/VariableNames" },
  ])),
};
d.AllowRule.properties.expansions = { $ref: "#/$defs/ExpansionPermissions" };
d.AllowMatch.required = d.AllowMatch.required.filter((key) => key !== "classification");
d.AllowMatch.properties.classification = { enum: ["complete", "parameter"] };
for (const name of ["OrdinaryMatch", "NestedPartTest", "NestedPartPolicy"]) {
  d[name].properties.classification = { enum: ["complete", "parameter", "opaque", "invalid"] };
}
for (const name of ["PathPolicy", "NonRedirectPathPolicy", "RedirectPathPolicy"]) {
  d[name].properties.any = { const: true };
  d[name].oneOf.push({ required: ["any"] });
}
d.RedirectEntry.properties.target.properties.kind.enum.push("parameterPath");
d.RedirectTest.properties.targetKind.enum.push("parameterPath");
d.RedirectEntry.allOf[0].if.properties.operator.enum = ["<"];
d.RedirectEntry.allOf.push({
  if: { required: ["operator"], properties: { operator: { enum: [">", ">>"] } } },
  then: { properties: { target: { type: "object", properties: { kind: { enum: ["literalPath", "parameterPath"] } } } } },
});
emit("schemas/shell-warden.config.v3.schema.json", config);

const verdict = read("schemas/shell-warden.verdict.v2.schema.json");
verdict.$id = verdict.$id.replace(".v2.", ".v3.");
verdict.title = "Shell Warden verdict v3";
verdict.properties.protocol.const = "shell-warden.verdict.v3";
const v = verdict.definitions;
v.Reason.enum.push("parameter-expansion", "predicate-unknown");
v.Reasons.maxItems = 19;
v.UncertainPredicate = {
  type: "object", required: ["ruleId", "predicates"], additionalProperties: false,
  properties: {
    ruleId: { $ref: "#/definitions/RuleId" },
    predicates: {
      type: "array", minItems: 1, maxItems: 4096, uniqueItems: true,
      items: { type: "string", maxLength: 256, pattern: "^/parts/[0-9]+/match/(arguments|options|environment|redirects|paths|facts|nestedParts)(/[^\\s/]+)*$" },
    },
  },
};
v.FullDiagnostics.required.push("uncertain");
v.FullDiagnostics.properties.uncertain = {
  type: "array", maxItems: 4096, items: { $ref: "#/definitions/UncertainPredicate" },
};
v.FullDiagnostics.properties.evidence.enum.push("parameter");
v.TruncatedDiagnostics.properties.evidence.enum.push("parameter");
v.Command.properties.classification.enum.push("parameter");
v.Command.properties.match.enum.push("expression");
v.Command.allOf[0].oneOf.push({
  required: ["facts"],
  properties: { classification: { const: "parameter" }, match: { const: "expression" }, verdict: { enum: ["allow", "ask", "deny"] } },
});
v.Command.allOf.push({
  if: { required: ["classification"], properties: { classification: { const: "parameter" } } },
  then: { required: ["facts"], properties: { facts: { type: "object", properties: { evidence: { const: "parameter" } } } } },
});
v.Command.allOf.push({
  if: { required: ["facts"], properties: { facts: { type: "object", required: ["reasons"], properties: { reasons: { contains: { const: "predicate-unknown" } } } } } },
  then: { properties: { verdict: { enum: ["ask", "deny"] } } },
});
emit("schemas/shell-warden.verdict.v3.schema.json", verdict);

const configBase = {
  version: 3,
  defaults: { action: "ask", redirectPolicy: "none" },
  redirectPolicies: { none: { redirects: { none: true }, paths: { none: true } } },
  profiles: [{
    id: "ls", executables: ["ls"], options: {}, analyzer: "generic-v1",
    pathSources: [{ argument: { index: 0, remainder: true } }],
    rules: [{
      id: "allow", action: "allow", expansions: { arguments: ["HOME"] },
      match: {
        arguments: { prefix: [], remainder: { each: { any: true } } },
        options: { none: true }, environment: { none: true },
        paths: { all: [{ coordinate: { argument: { index: 0, remainder: true } }, any: true }] },
        facts: { none: true }, nestedParts: { none: true },
      },
    }],
  }],
};
const configFixtures = [];
function configVector(name, valid, mutate, schemaValid = valid) {
  const value = structuredClone(configBase);
  mutate(value, value.profiles[0].rules[0]);
  const relative = `${valid ? "valid" : "invalid"}/${name}.json`;
  emit(`schemas/fixtures/shell-warden.config.v3/${relative}`, value);
  configFixtures.push({ path: relative, valid, ...(schemaValid !== valid ? { schemaValid } : {}) });
}
configVector("argument-home", true, () => {});
configVector("empty-contexts", true, (_c, r) => { r.expansions = { arguments: [], redirectTargets: [], assignmentValues: [] }; });
configVector("no-grant", true, (_c, r) => { delete r.expansions; });
configVector("independent-contexts", true, (_c, r) => { r.expansions = { arguments: ["HOME"], redirectTargets: ["TMPDIR"], assignmentValues: ["CACHE", "_HOME2"] }; });
configVector("classifier-parameter", true, (_c, r) => { r.match.classification = "parameter"; });
configVector("classifier-complete", true, (_c, r) => { r.match.classification = "complete"; });
configVector("selector-count-boundary", true, (_c, r) => { r.expansions.arguments = Array.from({ length: 64 }, (_, i) => `VAR_${i}`); });
configVector("retired-v2", false, (c) => { c.version = 2; });
configVector("duplicate-name", false, (_c, r) => { r.expansions.arguments = ["HOME", "HOME"]; });
configVector("wildcard", false, (_c, r) => { r.expansions.arguments = ["H*"]; });
configVector("non-identifier", false, (_c, r) => { r.expansions.arguments = ["2HOME"]; });
configVector("unicode-identifier", false, (_c, r) => { r.expansions.arguments = ["HÖME"]; });
configVector("name-over-bound", false, (_c, r) => { r.expansions.arguments = ["H".repeat(129)]; });
configVector("selector-over-bound", false, (_c, r) => { r.expansions.arguments = Array.from({ length: 65 }, (_, i) => `VAR_${i}`); });
configVector("configured-runtime-value", false, (_c, r) => { r.expansions.arguments = { HOME: "/home/example" }; });
configVector("unknown-context", false, (_c, r) => { r.expansions.environment = ["HOME"]; });
configVector("null-grants", false, (_c, r) => { r.expansions = null; });
configVector("null-classification", false, (_c, r) => { r.match.classification = null; });
configVector("ask-grant", false, (_c, r) => { r.action = "ask"; });
configVector("deny-grant", false, (_c, r) => { r.action = "deny"; });
configVector("path-any-false", false, (_c, r) => { r.match.paths.all[0].any = false; });
configVector("mixed-path-selectors", false, (_c, r) => { r.match.paths.all[0].within = "/"; });
configVector("null-path-any", false, (_c, r) => { r.match.paths.all[0].any = null; r.match.paths.all[0].within = "/"; });
for (const [operator, valid] of [[">", true], [">>", true], ["<", false], [">&", false]]) {
  configVector(`parameter-redirect-${operator === ">" ? "write" : operator === ">>" ? "append" : operator === "<" ? "input" : "fd"}`, valid, (c, r) => {
    c.redirectPolicies.io = {
      redirects: { all: [{ operator, sourceFd: "default", occurrence: "all", target: { kind: "parameterPath" } }] },
      paths: { all: [{ coordinate: { redirect: { operator, sourceFd: "default", occurrence: "all" } }, any: true }] },
    };
    r.expansions.redirectTargets = ["HOME"];
  });
}
// ADR 0025 belongs to the active v3 contract after ADR 0026 landed.
// Semantic-only rejections stay schema-valid and are rejected by the checker.
for (const [name, executables, valid, schemaValid = valid, analyzer] of [
  ["same-name-paths", ["tool", "/opt/tool", "/home/user/tool"], true],
  ["paths-only", ["/opt/tool", "/home/user/tool"], true],
  ["node-alias-paths", ["node", "/opt/node", "/usr/bin/nodejs"], true],
  ["python-alias-paths", ["/opt/python", "/usr/bin/python3"], true],
  ["literal-unicode-spaces", ["工具", "/a b/工具"], true],
  ["literal-wildcards", ["*", "/opt/*"], true],
  ["literal-backslashes", ["c:\\tool", "/opt/c:\\tool"], true],
  ["absolute-sed", ["/opt/sed"], true, true, "sed-v1"],
  ["absolute-xargs", ["/opt/xargs"], true, true, "xargs-v1"],
  ["bare-export", ["export"], true, true, "export-v1"],
  ["empty-list", [], false],
  ["empty-spelling", [""], false],
  ["relative-head", ["./tool"], false],
  ["relative-directory", ["opt/tool"], false],
  ["root-only", ["/"], false],
  ["bare-dot", ["."], false],
  ["empty-component", ["/opt//tool"], false],
  ["dot-component", ["/opt/./tool"], false],
  ["parent-component", ["/opt/../tool"], false],
  ["trailing-slash", ["/opt/tool/"], false],
  ["ascii-control", ["to\u007fol"], false],
  ["terminal-newline", ["tool\n"], false],
  ["duplicate-spelling", ["tool", "tool"], false],
  ["unrelated-basenames", ["tool", "/opt/other"], false, true],
  ["union-alias-groups", ["node", "nodejs", "python", "python3"], false, true],
  ["incompatible-sed", ["tool"], false, true, "sed-v1"],
  ["incompatible-xargs", ["tool"], false, true, "xargs-v1"],
  ["incompatible-export", ["tool"], false, true, "export-v1"],
  ["path-export-generic", ["/opt/export"], false, true],
  ["path-export-specialized", ["export", "/opt/export"], false, true, "export-v1"],
  ["utf8-byte-boundary", ["é".repeat(2048)], true],
  ["utf8-byte-overflow", ["é".repeat(2048) + "a"], false, true],
]) {
  configVector(`executable-${name}`, valid, (c) => {
    c.profiles = [{ id: "enrollment", executables, options: {}, analyzer: analyzer ?? "generic-v1", rules: [] }];
  }, schemaValid);
}
emit("schemas/fixtures/shell-warden.config.v3/manifest.json", { fixtures: configFixtures });

const historical = read("schemas/fixtures/shell-warden.verdict.v2/manifest.json");
const fixtures = [];
for (const entry of historical.fixtures) {
  const source = fs.readFileSync(path.join(root, "schemas/fixtures/shell-warden.verdict.v2", entry.path), "utf8");
  let value;
  try {
    value = JSON.parse(source);
    if (value.protocol === "shell-warden.verdict.v2") value.protocol = "shell-warden.verdict.v3";
    // A previously unknown future version stays unknown after the replacement.
    else if (value.protocol === "shell-warden.verdict.v3") value.protocol = "shell-warden.verdict.v4";
    for (const command of value.result?.commands ?? []) {
      const facts = command.facts;
      if (facts && typeof facts === "object" && !Array.isArray(facts) && "votes" in facts) facts.uncertain = [];
    }
  } catch {
    value = source.replaceAll("shell-warden.verdict.v2", "shell-warden.verdict.v3");
  }
  emit(`schemas/fixtures/shell-warden.verdict.v3/${entry.path}`, value);
  fixtures.push({
    path: entry.path, valid: entry.phase === "valid",
    expectedInvocationId: entry.expectedInvocationId, positionalIndexes: entry.positionalIndexes,
  });
}
const full = () => ({
  evidence: "parameter", reasons: ["parameter-expansion"], selectedProfiles: ["ls"],
  matched: ["allow"], qualified: ["allow"], rejected: [], votes: ["allow:allow"], uncertain: [],
});
const base = () => ({
  protocol: "shell-warden.verdict.v3",
  result: { invocationId: "fixture:parameter", verdict: "allow", commands: [
    { index: 0, verdict: "allow", ruleId: "allow", classification: "parameter", match: "expression", facts: full() },
  ] },
});
function vector(name, valid, mutate) {
  const value = base();
  mutate(value, value.result.commands[0]);
  const relative = `${valid ? "valid" : "invalid"}/${name}.json`;
  emit(`schemas/fixtures/shell-warden.verdict.v3/${relative}`, value);
  fixtures.push({ path: relative, valid, expectedInvocationId: "fixture:parameter", positionalIndexes: [0] });
}
vector("parameter-allow", true, () => {});
vector("parameter-allow-other-rejected", true, (_e, c) => {
  c.facts.matched.push("other");
  c.facts.reasons.unshift("allow-coverage-missing");
  c.facts.rejected = [{ ruleId: "other", reasons: ["allow-coverage-missing"] }];
});
vector("parameter-rejected-evidence-not-complete", false, (_e, c) => {
  c.facts.matched.push("other");
  c.facts.rejected = [{ ruleId: "other", reasons: ["allow-evidence-not-complete"] }];
});
vector("parameter-rejected-coverage-not-aggregated", false, (_e, c) => {
  c.facts.matched.push("other");
  c.facts.rejected = [{ ruleId: "other", reasons: ["allow-coverage-missing"] }];
});
vector("predicate-unknown-ask", true, (e, c) => {
  e.result.verdict = c.verdict = "ask"; delete c.ruleId;
  c.facts.reasons.push("predicate-unknown");
  c.facts.uncertain = [{ ruleId: "restriction", predicates: ["/parts/0/match/paths/any/0"] }];
});
vector("predicate-unknown-truncated", true, (e, c) => {
  e.result.verdict = c.verdict = "ask"; delete c.ruleId;
  c.facts = { evidence: "parameter", reasons: ["parameter-expansion", "predicate-unknown"], diagnostics: "truncated-after-decision" };
});
vector("retired-v2", false, (e) => { e.protocol = "shell-warden.verdict.v2"; });
vector("parameter-argv", false, (_e, c) => { c.match = "argv"; });
vector("parameter-no-facts", false, (_e, c) => { delete c.facts; });
vector("parameter-runtime-literal", false, (_e, c) => { c.facts.evidence = "complete"; c.facts.reasons = ["complete"]; });
vector("parameter-allow-evidence-not-complete", false, (_e, c) => {
  c.facts.reasons.unshift("allow-evidence-not-complete");
});
vector("parameter-allow-evidence-not-complete-truncated", false, (_e, c) => {
  c.facts = {
    evidence: "parameter", reasons: ["allow-evidence-not-complete", "parameter-expansion"],
    diagnostics: "truncated-after-decision",
  };
});
vector("parameter-no-allow-vote", false, (_e, c) => { c.facts.votes = []; c.facts.qualified = []; });
vector("unknown-allow", false, (_e, c) => {
  c.facts.reasons.push("predicate-unknown");
  c.facts.uncertain = [{ ruleId: "restriction", predicates: ["/parts/0/match/paths/any/0"] }];
});
vector("unknown-no-attribution", false, (e, c) => { e.result.verdict = c.verdict = "ask"; delete c.ruleId; c.facts.reasons.push("predicate-unknown"); });
vector("attribution-no-reason", false, (e, c) => {
  e.result.verdict = c.verdict = "ask"; delete c.ruleId;
  c.facts.uncertain = [{ ruleId: "restriction", predicates: ["/parts/0/match/paths/any/0"] }];
});
vector("unknown-false-winning-rule", false, (e, c) => {
  e.result.verdict = c.verdict = "ask"; c.ruleId = "restriction";
  c.facts.reasons.push("predicate-unknown");
  c.facts.uncertain = [{ ruleId: "restriction", predicates: ["/parts/0/match/paths/any/0"] }];
});
vector("unknown-invalid-coordinate", false, (e, c) => {
  e.result.verdict = c.verdict = "ask"; delete c.ruleId;
  c.facts.reasons.push("predicate-unknown");
  c.facts.uncertain = [{ ruleId: "restriction", predicates: ["not-a-predicate"] }];
});
vector("missing-uncertain-field", false, (_e, c) => { delete c.facts.uncertain; });
vector("null-facts", false, (_e, c) => { c.facts = null; });
fixtures.sort((a, b) => a.path.localeCompare(b.path, "en"));
emit("schemas/fixtures/shell-warden.verdict.v3/manifest.json", { fixtures });
console.log(`${check ? "Verified" : "Generated"} ${files} v3 contract artifacts; ${mirrors.length} fixture mirrors.`);
