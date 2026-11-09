// shell-warden-config-v2-grammar: begin

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
#[serde(untagged)]
pub enum RedirectCoverage {
    None { none: bool },
    All { all: Vec<RedirectEntry> },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
#[serde(untagged)]
pub enum PathCoverage {
    None { none: bool },
    All { all: Vec<PathEntry> },
}

/// Positional coordinate source selector: one positional argument `index`
/// (0-based) plus an optional `remainder: true` flag selecting the
/// remainder arguments after the index (docs fixture
/// `PositionalCoordinate/index-and-remainder.json`).
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, sw_attrs::GrammarDocAttrs)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PositionalCoordinate {
    pub index: u32,
    #[serde(default)]
    pub remainder: bool,
}

/// Positional-argument matcher. `prefix` requires an explicit `remainder`;
/// `exact` must not carry one.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ArgumentsMatcher {
    #[serde(default)]
    pub exact: Option<Vec<String>>,
    #[serde(default)]
    pub prefix: Option<Vec<String>>,
    /// Remainder policy: only meaningful (and mandatory!) with `prefix`.
    pub remainder: Option<RemainderPolicy>,
    /// Existential test: any positional token matches one of these globs.
    #[serde(default)]
    pub contains_any: Option<Vec<String>>,
}

/// Cover the remaining positional arguments after `prefix`: `{none: true}` = no
/// further arguments; `{each: tokenValueSelector}` = every remaining literal
/// token must satisfy the token selector (closed vocabulary below).
#[derive(Debug, Clone, PartialEq, sw_attrs::GrammarDocAttrs)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub enum RemainderPolicy {
    None { none: bool },
    Each { each: TokenSelector },
}

/// Selection limit in one closed selector array (design §Limits):
/// `oneOf` alternatives. Fixed at 64, not configurable.
pub const MAX_SELECTOR_ALTERNATIVES: usize = 64;
/// Regex UTF-8-byte limit for one `re2-v1` pattern (design §Limits).
pub const MAX_REGEX_BYTES: usize = 1024;
/// Lexical-path UTF-8-byte limit (design §Limits).
pub const MAX_PATH_BYTES: usize = 4096;

/// Closed string-value selector (design §Action-sensitive matching):
/// `{"any": true}`, `{"oneOf": [literal, ...]}` or `{"regex": re2-v1}`.
/// Exactly one discriminator key per selector object; no globs, no coercion.
#[derive(Debug, Clone, PartialEq, sw_attrs::GrammarDocAttrs)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub enum StringValueSelector {
    /// Covers any complete literal token, including an empty inline value.
    Any,
    /// Covers one listed literal by exact equality. Non-empty (1..=64) and
    /// duplicate-free; `"*"` is a literal asterisk (wildcards live in `regex`).
    OneOf(Vec<String>),
    /// Whole-value `re2-v1` match; compiled when configuration loads.
    Regex(String),
}

/// Closed lexical path selector: exact / within / outside on absolute lexical
/// roots (component-boundary semantics of the lexical path policy; no I/O).
/// One key per selector object; a second key or an array is invalid.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, sw_attrs::GrammarDocAttrs)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[serde(untagged)]
pub enum PathSelector {
    Exact { exact: String },
    Within { within: String },
    Outside { outside: String },
}

/// Closed token-value selector: one string-value selector, or a lexical path
/// applied to the literal token. Both arms stay one-level on the wire:
/// `{"any": true}` / `{"oneOf": [...]}` / `{"regex": pattern}` / `{"path": …}`.
#[derive(Debug, Clone, PartialEq, sw_attrs::GrammarDocAttrs)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub enum TokenSelector {
    Str(StringValueSelector),
    Path(PathSelector),
}

impl TokenSelector {
    /// Decode convenience: the string-value arm, if any.
    pub fn as_str_selector(&self) -> Option<&StringValueSelector> {
        match self {
            TokenSelector::Str(s) => Some(s),
            TokenSelector::Path(..) => None,
        }
    }

    pub fn as_path(&self) -> Option<&PathSelector> {
        match self {
            TokenSelector::Str(_) => None,
            TokenSelector::Path(path) => Some(path),
        }
    }
}

/// Closed option-value coverage: `{"each": tokenValueSelector}` covers every
/// value ordinal of every occurrence; `{"byPosition": [selector, ...]}` has
/// exactly one selector per fixed value ordinal (zero-based array position ⇒
/// one-based ordinal). It never expresses a variable value count.
/// Closed option-value coverage: `{"each": tokenValueSelector}` covers every
/// value ordinal of every occurrence; `{"byPosition": [selector, ...]}` has
/// exactly one selector per fixed value ordinal (zero-based array position ⇒
/// one-based ordinal). It never expresses a variable value count.
#[derive(Debug, Clone, PartialEq, sw_attrs::GrammarDocAttrs)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub enum OptionValueCoverage {
    Each { each: TokenSelector },
    ByPosition { by_position: Vec<TokenSelector> },
}

impl OptionValueCoverage {
    /// `byPosition` is structurally bounded to the declared arity range
    /// (schema maxItems: 4); the per-option arity equality is checked against
    /// the profile declaration in config validation.
    pub fn validate_shape(&self) -> Result<(), String> {
        match self {
            OptionValueCoverage::Each { .. } => Ok(()),
            OptionValueCoverage::ByPosition { by_position } => {
                if by_position.is_empty() {
                    return Err(
                        "optionValueCoverage.byPosition must list at least one selector"
                            .to_string(),
                    );
                }
                if by_position.len() > MAX_OPTION_ARITY as usize {
                    return Err(format!(
                        "optionValueCoverage.byPosition exceeds {MAX_OPTION_ARITY} selectors"
                    ));
                }
                Ok(())
            }
        }
    }
}

/// Zero-arity option coverage entry: presence / repetition only — no values.
/// Both directions are hand-implemented at the `OptionCoverageEntry` union
/// level (derived untagged would drop `deny_unknown_fields` under serde's
/// content buffering).
#[derive(Debug, Clone, PartialEq)]
pub struct OptionCoverage {
    pub option: String,
    pub required: bool,
    pub repeatable: bool,
}

/// Fixed option grammar declaration: canonical ID → aliases + arity +
/// inline-form permission. Fixed arity 0..=4; no variadic, minArity or
/// maxArity form exists in v2. `--alias=value` is valid only when the option
/// has arity one and declares `inline: true`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, sw_attrs::GrammarDocAttrs)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OptionSpec {
    /// Aliases exactly as they may appear in argv (`--long`, `-f`).
    pub aliases: Vec<String>,
    /// 0..=4 (validated in config loader).
    pub arity: u8,
    /// Absent or false ⇒ the inline form `--alias=value` is rejected (arity
    /// one included); `true` is only valid for a declared arity-one option.
    #[serde(default)]
    pub inline: Option<bool>,
}

/// Positive-arity option coverage entry: additionally states the value
/// selector for every consumed or inline value (required, closed form).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PositiveArityOptionCoverage {
    pub option: String,
    pub required: bool,
    pub repeatable: bool,
    pub values: OptionValueCoverage,
}

/// One allow `options.allowed` entry: references a declared canonical profile
/// option and states `required` and `repeatable`; positive arity additionally
/// carries the closed value coverage. Canonical option IDs must stay unique
/// within one list (config validation); the union rejects a zero-arity entry
/// carrying `values` and a positive-arity entry without it.
/// One allow `options.allowed` entry: references a declared canonical profile
/// option and states `required` and `repeatable`; positive arity additionally
/// carries the closed value coverage. Canonical option IDs must stay unique
/// within one list (config validation); the union rejects a zero-arity entry
/// carrying `values` and a positive-arity entry without it.
#[derive(Debug, Clone, PartialEq)]
pub enum OptionCoverageEntry {
    ZeroArity(OptionCoverage),
    PositiveArity(PositiveArityOptionCoverage),
}

impl OptionCoverageEntry {
    pub fn option(&self) -> &str {
        match self {
            OptionCoverageEntry::ZeroArity(e) => &e.option,
            OptionCoverageEntry::PositiveArity(e) => &e.option,
        }
    }

    pub fn required(&self) -> bool {
        match self {
            OptionCoverageEntry::ZeroArity(e) => e.required,
            OptionCoverageEntry::PositiveArity(e) => e.required,
        }
    }

    pub fn repeatable(&self) -> bool {
        match self {
            OptionCoverageEntry::ZeroArity(e) => e.repeatable,
            OptionCoverageEntry::PositiveArity(e) => e.repeatable,
        }
    }

    pub fn values(&self) -> Option<&OptionValueCoverage> {
        match self {
            OptionCoverageEntry::ZeroArity(_) => None,
            OptionCoverageEntry::PositiveArity(e) => Some(&e.values),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OptionsMatcher {
    #[serde(default)]
    pub present_all: Option<Vec<String>>,
    #[serde(default)]
    pub present_any: Option<Vec<String>>,
    #[serde(default)]
    pub absent_all: Option<Vec<String>>,
    /// Existential value predicate: canonical option → selector; a selected
    /// occurrence whose value satisfies the selector makes the dimension hold.
    pub values: Option<std::collections::BTreeMap<String, TokenSelector>>,
    /// Allow coverage policy ({ "none": true }); selects the allow form.
    pub none: Option<bool>,
    /// Allow coverage policy ({ "allowed": [entry, ...] }).
    pub allowed: Option<Vec<OptionCoverageEntry>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EnvironmentTest {
    pub name: String,
    /// String-value selector (`any`/`oneOf`/`regex`) — optional = unconstrained.
    #[serde(default)]
    pub value: Option<StringValueSelector>,
    /// Assignment must sit in the command prefix (`FOO=1 cmd`) when true.
    #[serde(default)]
    pub prefix: Option<bool>,
    /// One-based occurrence ordinal (`"all"` = every occurrence).
    #[serde(default)]
    pub occurrence: Option<Occurrence>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FactTest {
    /// Closed analyzer id (`generic-v1`, `sed-v1`, …); required for allow
    /// fact entries, optional for ask/deny fact tests.
    #[serde(default)]
    pub analyzer: Option<String>,
    /// Closed analyzer version ("1"); defaults to the matching analyzer
    /// when omitted in ask/deny.
    #[serde(default)]
    pub version: Option<String>,
    pub name: String,
    /// One-based occurrence ordinal ("all" = every occurrence).
    #[serde(default)]
    pub occurrence: Option<Occurrence>,
    /// Typed value selector (None = every observed value matches).
    #[serde(default)]
    pub value: Option<TypedValueSelector>,
}

/// Deserializes a present optional value and rejects JSON `null`: the
/// public schema has no nullable selectors — an explicit `null` is not
/// "absent", it is a wire typo that must fail config parsing, never pass.
fn present_not_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Ok(Some(T::deserialize(deserializer)?))
}

/// One nested-part selector (`NestedPartTest` in the public config-v2
/// schema): every field is optional, but at least one selector must be
/// present (schema `minProperties: 1`, enforced at config validation).
/// Execution metadata — the executable head and the analyzer origin — stays
/// internal to the evidence and is not public config.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NestedPartTest {
    /// Closed relation vocabulary (`chain`, `pipeline`, `wrapper`,
    /// `command-substitution`, `analyzer-command`).
    #[serde(
        default,
        deserialize_with = "present_not_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub relation: Option<Relation>,
    /// Selected profile for the nested part: a declared profile id, or the
    /// literal `none` selecting parts with no selected profile.
    #[serde(
        default,
        deserialize_with = "present_not_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub profile: Option<String>,
    /// Match only when the nested part itself is in this evidence state.
    #[serde(
        default,
        deserialize_with = "present_not_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub classification: Option<EvidenceClass>,
    /// A nested part must already reduce to this verdict for the parent's
    /// nesting-coverage policy to cover it.
    #[serde(
        default,
        deserialize_with = "present_not_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub verdict: Option<VerdictKind>,
    /// One-based relation-occurrence ordinal (`all` = every occurrence).
    #[serde(
        default,
        deserialize_with = "present_not_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub occurrence: Option<Occurrence>,
}

/// The literal `none` profile selector for nested parts: selects parts with
/// no selected profile (public schema `NestedPartTest.profile` is
/// `profileId | "none"`).
pub const NESTED_PROFILE_NONE: &str = "none";

// shell-warden-config-v2-grammar: end
