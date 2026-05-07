use dax_indexer::{BuildOptions, Index, Query};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process;

#[derive(Debug, Deserialize)]
struct BuildRequest {
    repo_root: PathBuf,
    cache_dir: PathBuf,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    force: bool,
    #[serde(default)]
    excludes: Vec<String>,
}

#[derive(Debug, Serialize)]
struct BuildResponse {
    schema_version: String,
    files_indexed: usize,
    duration_ms: u128,
    cache_dir: String,
}

#[derive(Debug, Deserialize)]
struct QueryRequest {
    cache_dir: PathBuf,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    touched_files: Vec<String>,
    #[serde(default = "default_limit")]
    limit: usize,
}

#[derive(Debug, Serialize)]
struct QueryResponse {
    hits: Vec<dax_indexer::RelevanceHit>,
}

#[derive(Debug, Deserialize)]
struct FileRequest {
    cache_dir: PathBuf,
    file: String,
}

#[derive(Debug, Serialize)]
struct SymbolsResponse {
    symbols: Vec<dax_indexer::Symbol>,
}

#[derive(Debug, Deserialize)]
struct DumpRequest {
    cache_dir: PathBuf,
    #[serde(default = "default_dump_format")]
    format: String,
}

fn default_limit() -> usize {
    10
}

fn default_dump_format() -> String {
    "json".to_string()
}

/// JSON boundary entry point.
///
/// Commands:
///   dax-indexer build    — builds an index and writes it to cache_dir
///   dax-indexer query    — queries relevance hits from an existing cache
///   dax-indexer symbols  — lists symbols for one indexed file
///   dax-indexer imports  — lists imports and importers for one indexed file
///   dax-indexer dump     — emits full index JSON or a compact tree
///   dax-indexer version  — prints crate version
fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str).unwrap_or("query") {
        "build" => run_build(),
        "query" => run_query(),
        "symbols" => run_symbols(),
        "imports" => run_imports(),
        "dump" => run_dump(),
        "version" => println!("{}", env!("CARGO_PKG_VERSION")),
        other => {
            eprintln!("unknown command: {other}");
            eprintln!("usage: dax-indexer <build|query|symbols|imports|dump|version>");
            process::exit(1);
        }
    }
}

fn read_request<T: DeserializeOwned>() -> T {
    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        eprintln!("error reading stdin: {error}");
        process::exit(1);
    }
    match serde_json::from_str(&input) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("error parsing indexer request: {error}");
            process::exit(1);
        }
    }
}

fn print_json<T: Serialize>(value: &T) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).expect("serialization failed")
    );
}

fn load(cache_dir: &Path) -> Index {
    match Index::load(cache_dir) {
        Ok(index) => index,
        Err(error) => {
            eprintln!("indexer load error: {error}");
            process::exit(1);
        }
    }
}

fn run_build() {
    let request: BuildRequest = read_request();
    let start = std::time::Instant::now();
    match Index::build(
        &request.repo_root,
        &BuildOptions {
            project_id: request.project_id,
            excludes: request.excludes,
        },
    )
    .and_then(|index| {
        let files_indexed = index.files().len();
        index.save(&request.cache_dir)?;
        Ok((index, files_indexed))
    }) {
        Ok((index, files_indexed)) => {
            let _ = request.force;
            print_json(&BuildResponse {
                schema_version: index.schema_version,
                files_indexed,
                duration_ms: start.elapsed().as_millis(),
                cache_dir: request.cache_dir.to_string_lossy().replace('\\', "/"),
            });
        }
        Err(error) => {
            eprintln!("indexer build error: {error}");
            process::exit(1);
        }
    }
}

fn run_query() {
    let request: QueryRequest = read_request();
    let index = load(&request.cache_dir);
    let hits = index.relevance(
        &Query {
            keywords: request.keywords,
            touched_files: request.touched_files,
            filter_lang: None,
        },
        request.limit,
    );
    print_json(&QueryResponse { hits });
}

fn run_symbols() {
    let request: FileRequest = read_request();
    let index = load(&request.cache_dir);
    print_json(&SymbolsResponse {
        symbols: index.symbols(&request.file),
    });
}

fn run_imports() {
    let request: FileRequest = read_request();
    let index = load(&request.cache_dir);
    print_json(&index.imports_report(&request.file));
}

fn run_dump() {
    let request: DumpRequest = read_request();
    let index = load(&request.cache_dir);
    if request.format == "tree" {
        for file in index.files() {
            println!("{}", file.path);
        }
        return;
    }
    print_json(&index);
}
