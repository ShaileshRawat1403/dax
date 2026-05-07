use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use thiserror::Error;
use tree_sitter::{Node, Parser};
use walkdir::WalkDir;

pub const INDEX_SCHEMA_VERSION: &str = "dax.indexer.index.v1";

const DEFAULT_EXCLUDES: &[&str] = &[
    ".git/",
    ".dax/",
    "node_modules/",
    "target/",
    "dist/",
    "vendor/",
    ".env",
    ".pem",
    ".key",
    "id_rsa",
    "id_ed25519",
];

#[derive(Debug, Error)]
pub enum IndexerError {
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("json error at {path}: {source}")]
    Json {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("failed to load parser for {language}")]
    ParserLanguage { language: String },
    #[error("failed to parse {path}")]
    Parse { path: PathBuf },
    #[error("path is outside repo root: {path}")]
    OutsideRoot { path: PathBuf },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    TypeScript,
    Tsx,
    JavaScript,
    Jsx,
    Rust,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Symbol {
    pub name: String,
    pub kind: String,
    pub exported: bool,
    pub line: usize,
    pub col: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Import {
    pub from: String,
    pub names: Vec<String>,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub lang: Language,
    pub content_hash: String,
    pub mtime_ns: u128,
    pub symbols: Vec<Symbol>,
    pub imports: Vec<Import>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Index {
    pub schema_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub repo_root: String,
    pub generated_at: String,
    pub language_versions: BTreeMap<String, String>,
    pub exclude_fingerprint: String,
    pub files: Vec<FileEntry>,
}

#[derive(Debug, Clone, Default)]
pub struct BuildOptions {
    pub project_id: Option<String>,
    pub excludes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Query {
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub touched_files: Vec<String>,
    #[serde(default)]
    pub filter_lang: Option<Language>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Definition {
    pub path: String,
    pub symbol: Symbol,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RelevanceHit {
    pub path: String,
    pub score: f32,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImportsReport {
    pub imports: Vec<Import>,
    pub importers: Vec<String>,
}

struct Extraction {
    symbols: Vec<Symbol>,
    imports: Vec<Import>,
    parse_error: Option<String>,
}

impl Index {
    pub fn build(repo_root: &Path, opts: &BuildOptions) -> Result<Self, IndexerError> {
        let repo_root = fs::canonicalize(repo_root).map_err(|source| IndexerError::Io {
            path: repo_root.to_path_buf(),
            source,
        })?;
        let mut excludes = DEFAULT_EXCLUDES
            .iter()
            .map(|item| item.to_string())
            .collect::<Vec<_>>();
        excludes.extend(opts.excludes.iter().cloned());

        let mut files = Vec::new();
        for entry in WalkDir::new(&repo_root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let rel = relative_path(&repo_root, path)?;
            if should_exclude(&rel, &excludes) {
                continue;
            }
            let Some(lang) = Language::from_path(&rel) else {
                continue;
            };
            files.push(index_file(&repo_root, path, &rel, lang)?);
        }

        files.sort_by(|a, b| a.path.cmp(&b.path));

        Ok(Index {
            schema_version: INDEX_SCHEMA_VERSION.to_string(),
            project_id: opts.project_id.clone(),
            repo_root: slash_path(&repo_root),
            generated_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            language_versions: language_versions(),
            exclude_fingerprint: fingerprint(&excludes),
            files,
        })
    }

    pub fn load(cache_dir: &Path) -> Result<Self, IndexerError> {
        let path = cache_dir.join("index.json");
        let input = fs::read_to_string(&path).map_err(|source| IndexerError::Io {
            path: path.clone(),
            source,
        })?;
        serde_json::from_str(&input).map_err(|source| IndexerError::Json { path, source })
    }

    pub fn save(&self, cache_dir: &Path) -> Result<(), IndexerError> {
        fs::create_dir_all(cache_dir).map_err(|source| IndexerError::Io {
            path: cache_dir.to_path_buf(),
            source,
        })?;
        let files_dir = cache_dir.join("files");
        fs::create_dir_all(&files_dir).map_err(|source| IndexerError::Io {
            path: files_dir.clone(),
            source,
        })?;

        for file in &self.files {
            let filename = file.content_hash.trim_start_matches("sha256:");
            let path = files_dir.join(format!("{filename}.json"));
            let json = serde_json::to_string_pretty(file).map_err(|source| IndexerError::Json {
                path: path.clone(),
                source,
            })?;
            fs::write(&path, json).map_err(|source| IndexerError::Io { path, source })?;
        }

        let path = cache_dir.join("index.json");
        let json = serde_json::to_string_pretty(self).map_err(|source| IndexerError::Json {
            path: path.clone(),
            source,
        })?;
        fs::write(&path, json).map_err(|source| IndexerError::Io { path, source })
    }

    pub fn files(&self) -> &[FileEntry] {
        &self.files
    }

    pub fn symbols(&self, file: &str) -> Vec<Symbol> {
        let file = normalize_query_path(file);
        self.files
            .iter()
            .find(|entry| entry.path == file)
            .map(|entry| entry.symbols.clone())
            .unwrap_or_default()
    }

    pub fn definitions(&self, name: &str) -> Vec<Definition> {
        self.files
            .iter()
            .flat_map(|entry| {
                entry
                    .symbols
                    .iter()
                    .filter(|symbol| symbol.name == name)
                    .cloned()
                    .map(|symbol| Definition {
                        path: entry.path.clone(),
                        symbol,
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    pub fn importers(&self, file: &str) -> Vec<String> {
        let target = normalize_query_path(file);
        let target_stem = Path::new(&target)
            .file_stem()
            .and_then(|item| item.to_str())
            .unwrap_or(&target);
        self.files
            .iter()
            .filter(|entry| {
                entry.imports.iter().any(|import| {
                    let from = import.from.replace('\\', "/");
                    from == target || from.ends_with(&target) || from.ends_with(target_stem)
                })
            })
            .map(|entry| entry.path.clone())
            .collect()
    }

    pub fn imports_report(&self, file: &str) -> ImportsReport {
        ImportsReport {
            imports: self
                .files
                .iter()
                .find(|entry| entry.path == normalize_query_path(file))
                .map(|entry| entry.imports.clone())
                .unwrap_or_default(),
            importers: self.importers(file),
        }
    }

    pub fn relevance(&self, query: &Query, limit: usize) -> Vec<RelevanceHit> {
        let keywords = query
            .keywords
            .iter()
            .flat_map(|keyword| tokenize(keyword))
            .collect::<Vec<_>>();
        if keywords.is_empty() {
            return Vec::new();
        }

        let touched = query
            .touched_files
            .iter()
            .map(|file| normalize_query_path(file))
            .collect::<Vec<_>>();

        let mut hits = self
            .files
            .iter()
            .filter(|entry| query.filter_lang.is_none_or(|lang| lang == entry.lang))
            .filter_map(|entry| {
                let mut score = 0.0_f32;
                let mut reasons = Vec::new();
                let path_lower = entry.path.to_lowercase();

                for keyword in &keywords {
                    if path_lower.contains(keyword) {
                        score += 5.0;
                        reasons.push(format!("path match: {keyword}"));
                    }
                    for symbol in &entry.symbols {
                        if symbol.name.to_lowercase().contains(keyword) {
                            score += if symbol.exported { 12.0 } else { 8.0 };
                            reasons.push(format!("symbol match: {}", symbol.name));
                        }
                    }
                    for import in &entry.imports {
                        if import.from.to_lowercase().contains(keyword) {
                            score += 3.0;
                            reasons.push(format!("import match: {}", import.from));
                        }
                    }
                }

                for touched_file in &touched {
                    if touched_file == &entry.path {
                        score += 2.0;
                        reasons.push("recently touched".to_string());
                    } else if same_parent(touched_file, &entry.path) {
                        score += 1.0;
                        reasons.push(format!("near touched file: {touched_file}"));
                    }
                }

                if score <= 0.0 {
                    None
                } else {
                    reasons.sort();
                    reasons.dedup();
                    Some(RelevanceHit {
                        path: entry.path.clone(),
                        score,
                        reasons,
                    })
                }
            })
            .collect::<Vec<_>>();

        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.path.cmp(&b.path))
        });
        hits.truncate(limit);
        hits
    }
}

impl Language {
    fn from_path(path: &str) -> Option<Self> {
        match Path::new(path).extension().and_then(|item| item.to_str()) {
            Some("ts") => Some(Language::TypeScript),
            Some("tsx") => Some(Language::Tsx),
            Some("js") | Some("mjs") | Some("cjs") => Some(Language::JavaScript),
            Some("jsx") => Some(Language::Jsx),
            Some("rs") => Some(Language::Rust),
            _ => None,
        }
    }
}

fn index_file(
    repo_root: &Path,
    path: &Path,
    rel: &str,
    lang: Language,
) -> Result<FileEntry, IndexerError> {
    let source = fs::read_to_string(path).map_err(|source| IndexerError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let metadata = fs::metadata(path).map_err(|source| IndexerError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let mtime_ns = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();

    let extraction = extract(lang, &source, path)?;
    let abs = repo_root.join(rel);
    let content_hash = hash_bytes(source.as_bytes());
    let normalized = relative_path(repo_root, &abs)?;

    Ok(FileEntry {
        path: normalized,
        lang,
        content_hash,
        mtime_ns,
        symbols: extraction.symbols,
        imports: extraction.imports,
        parse_error: extraction.parse_error,
    })
}

fn extract(lang: Language, source: &str, path: &Path) -> Result<Extraction, IndexerError> {
    let mut parser = Parser::new();
    let language = match lang {
        Language::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        Language::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
        Language::JavaScript | Language::Jsx => tree_sitter_javascript::LANGUAGE.into(),
        Language::Rust => tree_sitter_rust::LANGUAGE.into(),
    };
    parser
        .set_language(&language)
        .map_err(|_| IndexerError::ParserLanguage {
            language: format!("{lang:?}"),
        })?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| IndexerError::Parse {
            path: path.to_path_buf(),
        })?;
    let parse_error = tree
        .root_node()
        .has_error()
        .then(|| "tree-sitter reported syntax errors".to_string());

    let mut symbols = Vec::new();
    let mut imports = Vec::new();
    visit(
        tree.root_node(),
        source.as_bytes(),
        lang,
        false,
        &mut symbols,
        &mut imports,
    );
    symbols.sort_by(|a, b| {
        a.line
            .cmp(&b.line)
            .then_with(|| a.col.cmp(&b.col))
            .then_with(|| a.name.cmp(&b.name))
    });
    symbols.dedup_by(|a, b| {
        a.name == b.name && a.kind == b.kind && a.line == b.line && a.col == b.col
    });
    imports.sort_by(|a, b| a.line.cmp(&b.line).then_with(|| a.from.cmp(&b.from)));
    imports.dedup_by(|a, b| a.from == b.from && a.line == b.line);

    Ok(Extraction {
        symbols,
        imports,
        parse_error,
    })
}

fn visit(
    node: Node,
    source: &[u8],
    lang: Language,
    exported_parent: bool,
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    let kind = node.kind();
    let exported = exported_parent
        || kind == "export_statement"
        || node_text(node, source).starts_with("export ");

    match lang {
        Language::TypeScript | Language::Tsx | Language::JavaScript | Language::Jsx => {
            extract_js_like_node(node, source, exported, symbols, imports);
        }
        Language::Rust => {
            extract_rust_node(node, source, symbols, imports);
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        visit(child, source, lang, exported, symbols, imports);
    }
}

fn extract_js_like_node(
    node: Node,
    source: &[u8],
    exported: bool,
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    match node.kind() {
        "import_statement" => {
            if let Some(import) = parse_js_import(node, source) {
                imports.push(import);
            }
        }
        "function_declaration" => push_named_symbol(node, source, "function", exported, symbols),
        "class_declaration" => push_named_symbol(node, source, "class", exported, symbols),
        "interface_declaration" => push_named_symbol(node, source, "interface", exported, symbols),
        "type_alias_declaration" => push_named_symbol(node, source, "type", exported, symbols),
        "enum_declaration" => push_named_symbol(node, source, "enum", exported, symbols),
        "lexical_declaration" | "variable_declaration" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "variable_declarator" {
                    push_named_symbol(child, source, "variable", exported, symbols);
                }
            }
        }
        "export_statement" if node_text(node, source).contains(" default ") => {
            let mut has_named_child = false;
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if matches!(
                    child.kind(),
                    "function_declaration" | "class_declaration" | "lexical_declaration"
                ) {
                    has_named_child = true;
                }
            }
            if !has_named_child {
                push_symbol(node, "default", "default", true, symbols);
            }
        }
        _ => {}
    }
}

fn extract_rust_node(
    node: Node,
    source: &[u8],
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    match node.kind() {
        "use_declaration" => imports.push(parse_rust_use(node, source)),
        "function_item" => push_named_symbol(
            node,
            source,
            "function",
            rust_exported(node, source),
            symbols,
        ),
        "struct_item" => {
            push_named_symbol(node, source, "struct", rust_exported(node, source), symbols)
        }
        "enum_item" => {
            push_named_symbol(node, source, "enum", rust_exported(node, source), symbols)
        }
        "trait_item" => {
            push_named_symbol(node, source, "trait", rust_exported(node, source), symbols)
        }
        "impl_item" => {
            let text = node_text(node, source);
            if let Some(name) = text
                .split_whitespace()
                .collect::<Vec<_>>()
                .windows(2)
                .find_map(|pair| (pair[0] == "impl").then(|| pair[1].trim_matches('{').to_string()))
            {
                push_symbol(node, &name, "impl", rust_exported(node, source), symbols);
            }
        }
        "mod_item" => {
            push_named_symbol(node, source, "module", rust_exported(node, source), symbols)
        }
        "type_item" => {
            push_named_symbol(node, source, "type", rust_exported(node, source), symbols)
        }
        "const_item" => {
            push_named_symbol(node, source, "const", rust_exported(node, source), symbols)
        }
        "static_item" => {
            push_named_symbol(node, source, "static", rust_exported(node, source), symbols)
        }
        _ => {}
    }
}

fn push_named_symbol(
    node: Node,
    source: &[u8],
    kind: &str,
    exported: bool,
    symbols: &mut Vec<Symbol>,
) {
    if let Some(name) = node
        .child_by_field_name("name")
        .map(|child| node_text(child, source))
        .filter(|name| !name.is_empty())
    {
        push_symbol(node, &name, kind, exported, symbols);
    }
}

fn push_symbol(node: Node, name: &str, kind: &str, exported: bool, symbols: &mut Vec<Symbol>) {
    let pos = node.start_position();
    symbols.push(Symbol {
        name: name.to_string(),
        kind: kind.to_string(),
        exported,
        line: pos.row + 1,
        col: pos.column,
    });
}

fn parse_js_import(node: Node, source: &[u8]) -> Option<Import> {
    let text = node_text(node, source);
    let from = quoted_after_from(&text).or_else(|| first_quoted(&text))?;
    let names = if let Some((_, rest)) = text.split_once('{') {
        rest.split_once('}')
            .map(|(inside, _)| {
                inside
                    .split(',')
                    .map(|item| item.trim())
                    .filter(|item| !item.is_empty())
                    .map(|item| {
                        item.split_whitespace()
                            .last()
                            .unwrap_or(item)
                            .trim()
                            .to_string()
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    Some(Import {
        from,
        names,
        line: node.start_position().row + 1,
    })
}

fn parse_rust_use(node: Node, source: &[u8]) -> Import {
    let text = node_text(node, source);
    let from = text
        .trim()
        .trim_start_matches("pub ")
        .trim_start_matches("use ")
        .trim_end_matches(';')
        .trim()
        .to_string();
    let names = from
        .split("::")
        .last()
        .map(|tail| {
            tail.trim_matches('{')
                .trim_matches('}')
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Import {
        from,
        names,
        line: node.start_position().row + 1,
    }
}

fn quoted_after_from(text: &str) -> Option<String> {
    text.split_once(" from ")
        .and_then(|(_, rest)| first_quoted(rest))
}

fn first_quoted(text: &str) -> Option<String> {
    let quote_index = text.find(['"', '\''])?;
    let quote = text.as_bytes()[quote_index] as char;
    let rest = &text[quote_index + 1..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn rust_exported(node: Node, source: &[u8]) -> bool {
    node_text(node, source).trim_start().starts_with("pub ")
}

fn node_text(node: Node, source: &[u8]) -> String {
    node.utf8_text(source)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn relative_path(root: &Path, path: &Path) -> Result<String, IndexerError> {
    let rel = path
        .strip_prefix(root)
        .map_err(|_| IndexerError::OutsideRoot {
            path: path.to_path_buf(),
        })?;
    Ok(slash_path(rel))
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn should_exclude(path: &str, excludes: &[String]) -> bool {
    let normalized = normalize_query_path(path);
    excludes.iter().any(|exclude| {
        let exclude = exclude.replace('\\', "/");
        normalized == exclude.trim_end_matches('/')
            || normalized.starts_with(&exclude)
            || normalized.contains(&format!("/{exclude}"))
            || normalized.ends_with(&exclude)
    })
}

fn normalize_query_path(file: &str) -> String {
    file.replace('\\', "/").trim_start_matches("./").to_string()
}

fn fingerprint(excludes: &[String]) -> String {
    let mut sorted = excludes.to_vec();
    sorted.sort();
    hash_bytes(sorted.join("\n").as_bytes())
}

fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{digest:x}")
}

fn language_versions() -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "javascript".to_string(),
            "tree-sitter-javascript:0.25".to_string(),
        ),
        ("rust".to_string(), "tree-sitter-rust:0.24".to_string()),
        (
            "typescript".to_string(),
            "tree-sitter-typescript:0.23".to_string(),
        ),
    ])
}

fn tokenize(input: &str) -> Vec<String> {
    input
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
        .map(|part| part.trim().to_lowercase())
        .filter(|part| !part.is_empty())
        .collect()
}

fn same_parent(a: &str, b: &str) -> bool {
    Path::new(a).parent() == Path::new(b).parent()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_dir() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("dax-indexer-{stamp}"));
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::create_dir_all(dir.join("crates/demo/src")).unwrap();
        fs::write(
            dir.join("src/approval.ts"),
            r#"
import { Storage } from "./storage"
export interface ApprovalRequest { id: string }
export function createApproval(request: ApprovalRequest) { return request.id }
const localOnly = true
"#,
        )
        .unwrap();
        fs::write(
            dir.join("src/storage.ts"),
            r#"
export class Storage {}
export default Storage
"#,
        )
        .unwrap();
        fs::write(
            dir.join("crates/demo/src/lib.rs"),
            r#"
pub struct LedgerEntry;
pub fn append_entry() {}
use std::path::PathBuf;
"#,
        )
        .unwrap();
        dir
    }

    #[test]
    fn builds_structural_index() {
        let dir = fixture_dir();
        let index = Index::build(
            &dir,
            &BuildOptions {
                project_id: Some("fixture".to_string()),
                excludes: vec![],
            },
        )
        .unwrap();

        assert_eq!(index.schema_version, INDEX_SCHEMA_VERSION);
        assert_eq!(index.files.len(), 3);
        let approval = index
            .files
            .iter()
            .find(|file| file.path == "src/approval.ts")
            .unwrap();
        assert!(approval
            .symbols
            .iter()
            .any(|symbol| symbol.name == "ApprovalRequest"));
        assert!(approval
            .symbols
            .iter()
            .any(|symbol| symbol.name == "createApproval"));
        assert!(approval
            .imports
            .iter()
            .any(|import| import.from == "./storage"));
    }

    #[test]
    fn scores_relevant_files() {
        let dir = fixture_dir();
        let index = Index::build(&dir, &BuildOptions::default()).unwrap();
        let hits = index.relevance(
            &Query {
                keywords: vec!["approval storage".to_string()],
                touched_files: vec![],
                filter_lang: None,
            },
            3,
        );

        assert_eq!(hits[0].path, "src/approval.ts");
        assert!(hits.iter().any(|hit| hit.path == "src/storage.ts"));
    }

    #[test]
    fn saves_and_loads_cache() {
        let dir = fixture_dir();
        let cache = dir.join(".cache");
        let index = Index::build(&dir, &BuildOptions::default()).unwrap();
        index.save(&cache).unwrap();

        let loaded = Index::load(&cache).unwrap();
        assert_eq!(loaded.schema_version, INDEX_SCHEMA_VERSION);
        assert_eq!(loaded.files.len(), index.files.len());
        assert!(cache.join("index.json").exists());
    }
}
