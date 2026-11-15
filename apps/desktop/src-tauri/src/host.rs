//! Runs the Host server (the sidecar folder built by `sidecar:build`, see docs/adr/0002) and
//! starts it again if it stops.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
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

#[derive(Default)]
pub struct HostServer {
    child: Mutex<Option<Child>>,
    started: AtomicBool,
    stopping: AtomicBool,
}

impl HostServer {
    /// Starts the server and keeps it running. Calling it again does nothing.
    pub fn start(self: &Arc<Self>, paths: Paths) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let server = Arc::clone(self);
        thread::spawn(move || server.supervise(paths));
    }

    /// Stops the server for good (the app is closing).
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn supervise(&self, paths: Paths) {
        let log = paths.log_file();
        let mut delay = Duration::ZERO;
        loop {
            thread::sleep(delay);
            let began = Instant::now();
            let reason = {
                let mut slot = self.child.lock().unwrap();
                if self.stopping.load(Ordering::SeqCst) {
                    return;
                }
                match spawn(&paths, &log) {
                    Ok(child) => {
                        *slot = Some(child);
                        None
                    }
                    Err(err) => Some(format!("could not start the server: {err}")),
                }
            };
            let reason = match reason {
                Some(reason) => reason,
                None => match self.wait_for_exit() {
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

    /// Waits until the server exits and says why; `None` when the app is stopping it.
    fn wait_for_exit(&self) -> Option<String> {
        loop {
            thread::sleep(Duration::from_millis(500));
            if self.stopping.load(Ordering::SeqCst) {
                return None;
            }
            let mut slot = self.child.lock().unwrap();
            let exited = match slot.as_mut()?.try_wait() {
                Ok(Some(status)) => format!("the server stopped ({status})"),
                Ok(None) => continue,
                Err(err) => format!("lost track of the server: {err}"),
            };
            *slot = None;
            return Some(exited);
        }
    }
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
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
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
