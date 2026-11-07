#!/usr/bin/env node

import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const AJV_VERSION = "8.17.1";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_PATH = join(ROOT, "schemas/shell-warden.config.v2.schema.json");
const FIXTURES_PATH = join(ROOT, "schemas/fixtures/shell-warden.config.v2");
const INVALID_KEYWORDS = new Map([
  ["bad-by-position-length.json", ["maxItems"]],
  ["duplicate-canonical-option-policies.json", ["uniqueItems"]],
  ["extend-without-additions.json", ["anyOf"]],
  ["fail-open-omitted-defaults.json", ["required"]],
  ["fail-open-omitted-dimension.json", ["required"]],
  ["inherit-with-additions.json", ["additionalProperties"]],
  ["inline-arity-greater-than-one.json", ["const"]],
  ["invalid-regex.json", ["pattern"]],
  ["missing-occurrence.json", ["required"]],
  ["missing-values-policy.json", ["required"]],
  ["multiple-coordinates.json", ["oneOf"]],
  ["multiple-union-arms.json", ["oneOf"]],
  ["nested-serde-each.json", ["oneOf"]],
  ["nested-serde-form.json", ["enum"]],
  ["nested-serde-none.json", ["oneOf"]],
  ["unknown-key.json", ["additionalProperties"]],
]);
const PATH_KEYWORDS = new Map([
  ["invalid/Config/type-coercion.json", ["const"]],
  ["invalid/FactPolicy/type-coercion.json", ["type"]],
  ["invalid/StringValueSelector/invalid-regex.json", ["not"]],
]);

export function definitionName(fixturePath) {
  const parts = fixturePath.split(/[\\/]/u);
  if (parts.length < 2) {
    throw new Error(`fixture path has no definition directory: ${fixturePath}`);
  }
  return parts.at(-2);
}

export function expectedKeywords(fixturePath) {
  const pathKeywords = PATH_KEYWORDS.get(fixturePath);
  if (pathKeywords !== undefined) {
    return new Set(pathKeywords);
  }
  const fileName = fixturePath.split(/[\\/]/u).at(-1);
  const keywords = INVALID_KEYWORDS.get(fileName);
  if (keywords === undefined) {
    throw new Error(`invalid fixture has no expected keyword class: ${fixturePath}`);
  }
  return new Set(keywords);
}

export function fixtureValues(document) {
  return Array.isArray(document) ? document : [document];
}

async function fixtureFiles(kind) {
  const kindPath = join(FIXTURES_PATH, kind);
  const definitions = (await readdir(kindPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const files = [];
  for (const definition of definitions) {
    const definitionPath = join(kindPath, definition);
    const names = (await readdir(definitionPath))
      .filter((name) => name.endsWith(".json"))
      .sort();
    files.push(...names.map((name) => join(definitionPath, name)));
  }
  return files;
}

function loadAjv() {
  const require = createRequire(import.meta.url);
  const installedVersion = require("ajv/package.json").version;
  if (installedVersion !== AJV_VERSION) {
    throw new Error(`Ajv ${AJV_VERSION} required, found ${installedVersion}`);
  }
  return require("ajv/dist/2020").default;
}

function displayPath(filePath) {
  return relative(FIXTURES_PATH, filePath).split(sep).join("/");
}

function formatErrors(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"}: ${error.keyword} ${error.message}`)
    .join("; ");
}

async function main() {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const Ajv2020 = loadAjv();
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
    strictRequired: false,
  });
  ajv.addSchema(schema);
  const validators = new Map();
  const failures = [];
  let checked = 0;

  for (const kind of ["valid", "invalid"]) {
    for (const filePath of await fixtureFiles(kind)) {
      const fixturePath = displayPath(filePath);
      const definition = definitionName(fixturePath);
      let validate = validators.get(definition);
      if (validate === undefined) {
        validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` });
        validators.set(definition, validate);
      }
      const values = fixtureValues(JSON.parse(await readFile(filePath, "utf8")));
      for (const [index, value] of values.entries()) {
        const valid = validate(value);
        checked += 1;
        if (kind === "valid" && !valid) {
          failures.push(`${fixturePath}[${index}] rejected: ${formatErrors(validate.errors)}`);
        }
        if (kind === "invalid" && valid) {
          failures.push(`${fixturePath}[${index}] unexpectedly accepted`);
        }
        if (kind === "invalid" && !valid) {
          const expected = expectedKeywords(fixturePath);
          const actual = new Set((validate.errors ?? []).map((error) => error.keyword));
          if (![...actual].some((keyword) => expected.has(keyword))) {
            failures.push(
              `${fixturePath}[${index}] failed with ${[...actual].sort().join(", ")}; ` +
                `expected ${[...expected].sort().join(", ")}`,
            );
          }
        }
      }
    }
  }

  if (failures.length) {
    throw new Error(`fixture validation failed:\n${failures.join("\n")}`);
  }
  console.log(`validated ${checked} shell-warden config v2 fixture cases with Ajv ${AJV_VERSION}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
