use crate::chain::{append, verify_chain};
use crate::entry::LedgerEntry;
use crate::error::LedgerError;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

const LOCK_TIMEOUT: Duration = Duration::from_secs(10);
const LOCK_POLL: Duration = Duration::from_millis(20);

/// Exclusive lock held for the read-modify-write of an append.
///
/// `append_to_file` reads the whole chain to find the previous entry and then
/// writes the next one. Without a lock two concurrent appends both read the
/// same tail, both compute the same `seq` and the same `prev_hash`, and both
/// write. The result fails `verify_chain` with a sequence gap from that point
/// on, permanently: the ledger is bricked, and the only signal is that
/// verification starts failing.
///
/// `create_new` is atomic on every platform this runs on, so it is the lock.
struct LedgerLock {
    path: PathBuf,
}

impl LedgerLock {
    fn acquire(target: &Path) -> Result<Self, LedgerError> {
        Self::acquire_with_wait(target, LOCK_TIMEOUT, sleep)
    }

    fn acquire_with_wait(
        target: &Path,
        timeout: Duration,
        mut wait: impl FnMut(Duration),
    ) -> Result<Self, LedgerError> {
        let path = lock_path(target);
        if let Some(parent) = path.parent() {
            create_dir_private(parent)?;
        }

        let deadline = Instant::now() + timeout;
        loop {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);

            match options.open(&path) {
                Ok(_) => return Ok(Self { path }),
                Err(error) if lock_is_busy(&error) => {
                    if Instant::now() >= deadline {
                        // Access-denied can also mean a real ACL denial. Never
                        // turn it into success or mislabel it as a stale lock.
                        if error.kind() != std::io::ErrorKind::AlreadyExists {
                            return Err(LedgerError::Io(error));
                        }
                        // A crashed process can leave the file behind. Report it
                        // rather than silently stealing the lock.
                        return Err(LedgerError::Io(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            format!(
                                "timed out waiting for the ledger lock at {}; remove it if no other dax process is running",
                                path.display()
                            ),
                        )));
                    }
                    wait(LOCK_POLL);
                }
                Err(error) => return Err(LedgerError::Io(error)),
            }
        }
    }
}

fn lock_is_busy(error: &std::io::Error) -> bool {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        return true;
    }
    // Windows can report access-denied during delete-pending, until the last
    // handle closes. Restrict retry to atomic lock creation, not ledger IO.
    #[cfg(windows)]
    if matches!(error.raw_os_error(), Some(5 | 32)) {
        return true;
    }
    false
}

impl Drop for LedgerLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn lock_path(target: &Path) -> PathBuf {
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".lock");
    target.with_file_name(name)
}

/// The ledger records who did what. It is readable only by its owner.
fn create_dir_private(path: &Path) -> Result<(), LedgerError> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

pub fn load_jsonl(path: &Path) -> Result<Vec<LedgerEntry>, LedgerError> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path)?;
    let mut entries = Vec::new();
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        entries.push(serde_json::from_str(line)?);
    }
    verify_chain(&entries)?;
    Ok(entries)
}

pub fn append_to_file(path: &Path, body: &Value, ts: &str) -> Result<LedgerEntry, LedgerError> {
    if let Some(parent) = path.parent() {
        create_dir_private(parent)?;
    }

    let _lock = LedgerLock::acquire(path)?;

    let entries = load_jsonl(path)?;
    let entry = append(entries.last(), body, ts);

    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(path)?;

    writeln!(file, "{}", serde_json::to_string(&entry)?)?;
    file.sync_data()?;

    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn concurrent_appends_produce_a_verifiable_chain() {
        let dir = std::env::temp_dir().join(format!("dax-ledger-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("ledger.jsonl");

        let threads: Vec<_> = (0..8)
            .map(|index| {
                let path = path.clone();
                std::thread::spawn(move || {
                    append_to_file(
                        &path,
                        &json!({ "kind": "run.created", "n": index }),
                        "2026-05-07T00:00:00Z",
                    )
                })
            })
            .collect();

        for thread in threads {
            thread
                .join()
                .expect("thread panicked")
                .expect("append failed");
        }

        let entries = load_jsonl(&path).expect("chain must verify after concurrent appends");
        assert_eq!(entries.len(), 8);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unrelated_errors_do_not_become_lock_contention() {
        for kind in [
            std::io::ErrorKind::NotFound,
            std::io::ErrorKind::InvalidInput,
            std::io::ErrorKind::Other,
        ] {
            assert!(!lock_is_busy(&std::io::Error::from(kind)));
        }
        #[cfg(not(windows))]
        assert!(!lock_is_busy(&std::io::Error::from(
            std::io::ErrorKind::PermissionDenied
        )));
    }

    #[test]
    fn existing_lock_times_out_without_stealing_it() {
        let dir = std::env::temp_dir().join(format!("dax-ledger-held-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ledger.jsonl");
        let held = lock_path(&path);
        fs::write(&held, "held").unwrap();
        let error =
            LedgerLock::acquire_with_wait(&path, Duration::ZERO, |_| panic!("deadline must fail"))
                .err()
                .expect("must reject held lock");
        match error {
            LedgerError::Io(error) => assert_eq!(error.kind(), std::io::ErrorKind::TimedOut),
            _ => panic!("expected IO error"),
        }
        assert_eq!(fs::read_to_string(&held).unwrap(), "held");
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn delete_pending_lock_retries_only_after_the_owner_handle_closes() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir =
            std::env::temp_dir().join(format!("dax-ledger-delete-pending-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ledger.jsonl");
        let lock = lock_path(&path);
        let handle = OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(7)
            .open(&lock)
            .unwrap();
        fs::remove_file(&lock).unwrap();
        // This is the exact baseline atomic-create operation, not a fake error.
        let error = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
            .unwrap_err();
        assert_eq!(error.raw_os_error(), Some(5));
        let mut held = Some(handle);
        let mut waits = 0;
        let acquired = LedgerLock::acquire_with_wait(&path, Duration::from_secs(1), |_| {
            waits += 1;
            drop(held.take());
        })
        .expect("must wait for delete-pending lock, then acquire it");
        assert!(
            waits > 0,
            "baseline rejection must trigger a real contention wait"
        );
        assert!(lock.exists());
        assert!(!path.exists());
        drop(acquired);
        assert!(!lock.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn persistent_delete_pending_denial_preserves_the_original_error() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir =
            std::env::temp_dir().join(format!("dax-ledger-delete-denied-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ledger.jsonl");
        let lock = lock_path(&path);
        let handle = OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(7)
            .open(&lock)
            .unwrap();
        fs::remove_file(&lock).unwrap();
        let error =
            LedgerLock::acquire_with_wait(&path, Duration::ZERO, |_| panic!("deadline must fail"))
                .err()
                .expect("must remain denied");
        match error {
            LedgerError::Io(error) => assert_eq!(error.raw_os_error(), Some(5)),
            _ => panic!("expected IO error"),
        }
        assert!(!path.exists());
        drop(handle);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn ledger_is_owner_only() {
        let dir = std::env::temp_dir().join(format!("dax-ledger-perm-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("ledger.jsonl");
        append_to_file(
            &path,
            &json!({ "kind": "run.created" }),
            "2026-05-07T00:00:00Z",
        )
        .unwrap();

        let file_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        let dir_mode = fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            file_mode, 0o600,
            "ledger must not be group or world readable"
        );
        assert_eq!(
            dir_mode, 0o700,
            "ledger directory must not be group or world readable"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
