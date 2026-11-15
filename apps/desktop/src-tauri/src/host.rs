//! Runs the Host server (the sidecar folder built by `sidecar:build`, see docs/adr/0002), starts
//! it again if it stops, and runs a restore while it is stopped.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// The port the Host listens on (`HOST_PORT` in packages/core).
pub const PORT: u16 = 47800;
/// The log is moved to `server.log.1` when it grows past this.
const LOG_LIMIT: u64 = 10 * 1024 * 1024;

pub struct Paths {
    pub node: PathBuf,
    pub server_dir: PathBuf,
    pub data_dir: PathBuf,
}

impl Paths {
    pub fn log_file(&self) -> PathBuf {
        self.data_dir.join("logs").join("server.log")
    }
}

/// Each start and stop bumps `generation`; a supervisor thread from an older generation (one that
/// was stopped) ends at its next check, so stop-then-start never leaves two of them running.
#[derive(Default)]
struct State {
    child: Option<Child>,
    running: bool,
    generation: u64,
}

#[derive(Default)]
pub struct HostServer {
    state: Mutex<State>,
}

impl HostServer {
    /// Starts the server and keeps it running. Does nothing while it already runs.
    pub fn start(self: &Arc<Self>, paths: Paths) {
        let generation = {
            let mut state = self.state.lock().unwrap();
            if state.running {
                return;
            }
            state.running = true;
            state.generation += 1;
            state.generation
        };
        let server = Arc::clone(self);
        thread::spawn(move || server.supervise(paths, generation));
    }

    /// Stops the server and waits until it has exited, so the database is closed.
    pub fn stop(&self) {
        let mut state = self.state.lock().unwrap();
        state.running = false;
        state.generation += 1;
        if let Some(mut child) = state.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn supervise(&self, paths: Paths, generation: u64) {
        let log = paths.log_file();
        let mut delay = Duration::ZERO;
        loop {
            thread::sleep(delay);
            let began = Instant::now();
            let reason = {
                let mut state = self.state.lock().unwrap();
                if state.generation != generation {
                    return;
                }
                match spawn(&paths, &log) {
                    Ok(child) => {
                        state.child = Some(child);
                        None
                    }
                    Err(err) => Some(format!("could not start the server: {err}")),
                }
            };
            let reason = match reason {
                Some(reason) => reason,
                None => match self.wait_for_exit(generation) {
                    Some(reason) => reason,
                    None => return,
                },
            };
            // A server that ran for a while restarts at once; one that keeps failing, more slowly.
            delay = if began.elapsed() > Duration::from_secs(60) {
                Duration::from_secs(1)
            } else {
                (delay * 2).clamp(Duration::from_secs(1), Duration::from_secs(30))
            };
            note(
                &log,
                &format!("{reason}; restarting in {} s", delay.as_secs()),
            );
        }
    }

    /// Waits until the server exits and says why; `None` when the app stopped it on purpose.
    fn wait_for_exit(&self, generation: u64) -> Option<String> {
        loop {
            thread::sleep(Duration::from_millis(500));
            let mut state = self.state.lock().unwrap();
            if state.generation != generation {
                return None;
            }
            let exited = match state.child.as_mut()?.try_wait() {
                Ok(Some(status)) => format!("the server stopped ({status})"),
                Ok(None) => continue,
                Err(err) => format!("lost track of the server: {err}"),
            };
            state.child = None;
            return Some(exited);
        }
    }
}

/// Runs the restore command (`dist/restore.mjs`, the same code as the server's `restore` CLI) on
/// the Host data. The server must be stopped. The current data is kept in `restore-previous-*`.
/// Returns what the command printed, or its error.
pub fn run_restore(paths: &Paths, backup: &Path) -> Result<String, String> {
    let mut command = Command::new(&paths.node);
    command
        .arg("dist/restore.mjs")
        .arg(backup)
        .arg("--data-dir")
        .arg(&paths.data_dir)
        .arg("--replace")
        .current_dir(&paths.server_dir)
        .env_remove("NODE_OPTIONS");
    no_console_window(&mut command);
    let output = command
        .output()
        .map_err(|err| format!("Could not run the restore: {err}"))?;
    let text = |bytes: &[u8]| String::from_utf8_lossy(bytes).trim().to_string();
    if output.status.success() {
        note(&paths.log_file(), &format!("restored {}", backup.display()));
        return Ok(text(&output.stdout));
    }
    let error = text(&output.stderr);
    note(&paths.log_file(), &format!("restore failed: {error}"));
    Err(if error.is_empty() {
        format!("The restore failed ({})", output.status)
    } else {
        error
    })
}

fn no_console_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

fn spawn(paths: &Paths, log: &Path) -> std::io::Result<Child> {
    fs::create_dir_all(log.parent().expect("log file has a folder"))?;
    if fs::metadata(log).is_ok_and(|m| m.len() > LOG_LIMIT) {
        let _ = fs::rename(log, log.with_extension("log.1"));
    }
    let out = OpenOptions::new().create(true).append(true).open(log)?;
    let mut command = Command::new(&paths.node);
    command
        .arg("dist/server.mjs")
        .current_dir(&paths.server_dir)
        .env("WB_DATA_DIR", &paths.data_dir)
        .env("WB_PORT", PORT.to_string())
        .env_remove("NODE_OPTIONS")
        .stdin(Stdio::null())
        .stdout(out.try_clone()?)
        .stderr(out);
    no_console_window(&mut command);
    command.spawn()
}

fn note(log: &Path, message: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log) {
        let _ = writeln!(file, "[desktop] {message}");
    }
}

/// Waits until the server accepts connections (it listens only after its migrations ran).
pub fn wait_until_ready(timeout: Duration) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], PORT));
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}
