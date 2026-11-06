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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
#[serde(untagged)]
pub enum PositionalCoordinate {
    N {
        index: u32,
        #[serde(default)]
        remainder: bool,
    },
    All { all: bool },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ArgumentsMatcher {
    #[serde(default)]
    pub exact: Option<Vec<String>>,
    #[serde(default)]
    pub prefix: Option<Vec<String>>,
    pub remainder: Option<RemainderPolicy>,
    #[serde(default)]
    pub contains_any: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub enum RemainderPolicy {
    None { none: bool },
    Each { each: TokenSelector },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub enum TokenSelector {
    Exact(Vec<String>),
    Within(String),
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
    pub values: Option<std::collections::BTreeMap<String, Vec<String>>>,
    pub none: Option<bool>,
    pub allowed: Option<Vec<OptionCoverage>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OptionCoverage {
    pub option: String,
    pub required: bool,
    pub repeatable: bool,
    pub values: Option<ValuesCoverage>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
#[serde(untagged)]
pub enum ValuesCoverage {
    None { none: bool },
    Each { each: Vec<String> },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EnvironmentTest {
    pub name: String,
    pub value: Option<String>,
    pub prefix: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FactTest {
    pub analyzer: Option<String>,
    pub name: String,
    #[serde(default)]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NestedPartTest {
    pub relation: Option<Relation>,
    pub executable: Option<String>,
    pub profile: Option<String>,
    pub analyzer: Option<String>,
    pub state: Option<EvidenceClass>,
    pub verdict: Option<VerdictKind>,
    #[serde(default)]
    pub occurrence: Option<Occurrence>,
}

// shell-warden-config-v2-grammar: end
