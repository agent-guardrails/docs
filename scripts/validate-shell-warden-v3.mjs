#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (require("ajv/package.json").version !== "8.17.1") throw new Error("Ajv 8.17.1 is required");
const Ajv = require("ajv");
const Ajv2020 = require("ajv/dist/2020");
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const config = new Ajv2020({ allErrors: true, strict: false }).compile(json("schemas/shell-warden.config.v3.schema.json"));
const schema = new Ajv({ allErrors: true, strict: false }).compile(json("schemas/shell-warden.verdict.v3.schema.json"));
const rank = (v) => ({ allow: 0, ask: 1, deny: 2 })[v];
const invalid = new Set(["unknown-option", "option-value-missing", "invalid-inline-option", "unsupported-syntax", "empty-command", "evidence-limit"]);
const sorted = (items) => items.every((s, i) => i === 0 || Buffer.compare(Buffer.from(items[i - 1]), Buffer.from(s)) < 0);
function depth(value) {
  if (!value || typeof value !== "object") return 0;
  return 1 + Math.max(0, ...Object.values(value).map(depth));
}

export function semanticErrors(value, expected) {
  const errors = [];
  const result = value.result;
  if (result.invocationId !== expected.expectedInvocationId) errors.push("invocation");
  if (result.commands.length !== expected.positionalIndexes.length) errors.push("coverage");
  let strongest = 0;
  for (const [i, command] of result.commands.entries()) {
    if (command.index !== i || expected.positionalIndexes[i] !== i) errors.push("index");
    strongest = Math.max(strongest, rank(command.verdict));
    const facts = command.facts;
    if (!facts) continue;
    if (Buffer.byteLength(JSON.stringify(facts)) > 16384 || depth(facts) > 8) errors.push("facts-bound");
    const reasons = facts.reasons;
    if (!sorted(reasons)) errors.push("reasons-order");
    const evidence = facts.evidence;
    if (evidence !== (command.classification === "static" ? "complete" : command.classification)) errors.push("evidence");
    if (evidence === "complete" && (!reasons.includes("complete") || reasons.some((r) =>
      invalid.has(r) || ["opaque-expansion", "parameter-expansion", "allow-evidence-not-complete"].includes(r)))) errors.push("complete-anchor");
    if (evidence === "parameter" && (!reasons.includes("parameter-expansion") ||
      reasons.some((r) => invalid.has(r) || ["opaque-expansion", "allow-evidence-not-complete"].includes(r)))) errors.push("parameter-anchor");
    if (evidence === "opaque" && (!reasons.includes("opaque-expansion") || reasons.some((r) => invalid.has(r)))) errors.push("opaque-anchor");
    if (evidence === "invalid" && !reasons.some((r) => invalid.has(r))) errors.push("invalid-anchor");
    if (command.verdict === "allow" && reasons.includes("predicate-unknown")) errors.push("unknown-floor");
    if ("diagnostics" in facts) continue;
    if (!sorted(facts.matched) || !sorted(facts.qualified)) errors.push("rule-order");
    if (!sorted(facts.uncertain.map((e) => e.ruleId)) || facts.uncertain.some((e) => !sorted(e.predicates))) errors.push("uncertainty-order");
    if (facts.uncertain.some((e) => e.predicates.some((p) => Number(p.split("/")[2]) > 0xffffffff))) errors.push("predicate-coordinate-bound");
    if (reasons.includes("predicate-unknown") !== (facts.uncertain.length > 0)) errors.push("uncertainty-reason");
    const rejected = new Set();
    for (const e of facts.rejected) {
      if (rejected.has(e.ruleId) || !sorted(e.reasons) || !facts.matched.includes(e.ruleId)) errors.push("rejected");
      rejected.add(e.ruleId);
    }
    const votes = facts.votes.map((v) => ({ action: v.slice(0, v.indexOf(":")), id: v.slice(v.indexOf(":") + 1) }));
    for (const vote of votes) {
      if (!facts.matched.includes(vote.id) || (vote.action === "allow" && !facts.qualified.includes(vote.id))) errors.push("vote");
      if (rank(vote.action) > rank(command.verdict)) errors.push("vote-floor");
    }
    for (const id of facts.qualified) {
      if (!facts.matched.includes(id) || !votes.some((v) => v.action === "allow" && v.id === id)) errors.push("qualification");
    }
    if (command.verdict === "allow" && !votes.some((v) => v.action === "allow")) errors.push("no-allow-vote");
    const winning = votes.filter((v) => v.action === command.verdict).map((v) => v.id)
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    if (command.ruleId !== winning[0]) errors.push("winning-rule");
  }
  if (rank(result.verdict) !== strongest) errors.push("aggregate");
  return errors;
}

export function accepts(text, expected) {
  if (Buffer.byteLength(text) > 65536) return false;
  let value;
  try { value = JSON.parse(text); } catch { return false; }
  return Boolean(schema(value)) && semanticErrors(value, expected).length === 0;
}

export function validateConfig(value) {
  return Boolean(config(value));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixtureRoot = "schemas/fixtures/shell-warden.verdict.v3";
  const manifest = json(`${fixtureRoot}/manifest.json`);
  for (const entry of manifest.fixtures) {
    const text = fs.readFileSync(path.join(root, fixtureRoot, entry.path), "utf8");
    if (accepts(text, entry) !== entry.valid) throw new Error(`verdict fixture disagrees: ${entry.path}`);
  }
  console.log(`Validated ${manifest.fixtures.length} verdict v3 fixtures.`);
  const configRoot = "schemas/fixtures/shell-warden.config.v3";
  const policies = json(`${configRoot}/manifest.json`);
  for (const entry of policies.fixtures) {
    if (validateConfig(json(`${configRoot}/${entry.path}`)) !== entry.valid) {
      throw new Error(`config fixture disagrees: ${entry.path}`);
    }
  }
  console.log(`Validated ${policies.fixtures.length} config v3 fixtures.`);
}
