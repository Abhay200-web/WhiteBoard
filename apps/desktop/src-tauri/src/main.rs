// Whiteboard desktop shell (Step T). Asks once whether this PC is the Host or connects to one,
// runs the Host server in Host mode, finds Hosts on the network, and keeps a tray icon.
// The window shows the web app (apps/web).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod discovery;
mod host;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_notification::NotificationExt;

/// Argument the autostart entry passes, so a start with Windows stays in the tray.
const MINIMIZED_ARG: &str = "--minimized";

use host::HostServer;

/// `window.whiteboardDesktop` for the web app (apps/web/src/lib/desktop.ts).
const BRIDGE: &str = r#"
window.whiteboardDesktop = Object.freeze({
  getMode: () => window.__TAURI__.core.invoke('get_mode'),
  setMode: (mode) => window.__TAURI__.core.invoke('set_mode', { mode }),
  startHost: () => window.__TAURI__.core.invoke('start_host'),
  discoverHosts: () => window.__TAURI__.core.invoke('discover_hosts'),
  restoreBackup: (backupDir, name) =>
    window.__TAURI__.core.invoke('restore_backup', { backupDir, name }),
  notify: (title, body) => window.__TAURI__.core.invoke('show_notification', { title, body }),
});
"#;

fn mode_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("mode.txt"))
}

fn read_mode(app: &AppHandle) -> Option<String> {
    let saved = fs::read_to_string(mode_file(app).ok()?).ok()?;
    let mode = saved.trim();
    (mode == "host" || mode == "client").then(|| mode.to_string())
}

fn server_paths(app: &AppHandle) -> Result<host::Paths, String> {
    let sidecar = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("sidecar");
    let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(host::Paths {
        node: sidecar.join("node.exe"),
        server_dir: sidecar.join("server"),
        data_dir: data.join("host"),
    })
}

/// `"host"`, `"client"`, or `null` before the first-run choice.
#[tauri::command]
fn get_mode(app: AppHandle) -> Option<String> {
    read_mode(&app)
}

#[tauri::command]
fn set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    if mode != "host" && mode != "client" {
        return Err(format!("Unknown mode: {mode}"));
    }
    let file = mode_file(&app)?;
    fs::create_dir_all(file.parent().expect("config file has a folder"))
        .map_err(|e| e.to_string())?;
    fs::write(file, mode).map_err(|e| e.to_string())?;
    // Chosen once, at first run: start with Windows, in the tray. Failing here is not fatal, the
    // app works without starting by itself.
    let _ = app.autolaunch().enable();
    Ok(())
}

/// Host mode only: starts the server if needed, waits until it answers, returns its address.
#[tauri::command]
async fn start_host(app: AppHandle) -> Result<String, String> {
    if read_mode(&app).as_deref() != Some("host") {
        return Err("This PC is not set up as the Host.".into());
    }
    let paths = server_paths(&app)?;
    let log = paths.log_file();
    app.state::<Arc<HostServer>>().start(paths);
    let ready =
        tauri::async_runtime::spawn_blocking(|| host::wait_until_ready(Duration::from_secs(120)))
            .await
            .map_err(|e| e.to_string())?;
    if ready {
        Ok(format!("http://127.0.0.1:{}", host::PORT))
    } else {
        Err(format!(
            "The Host server did not start. Details: {}",
            log.display()
        ))
    }
}

/// Host mode only: stops the server, restores backup `name` from `backup_dir` (the current data is
/// kept in `restore-previous-*`), and starts the server again, also when the restore failed.
#[tauri::command]
async fn restore_backup(
    app: AppHandle,
    backup_dir: String,
    name: String,
) -> Result<String, String> {
    if read_mode(&app).as_deref() != Some("host") {
        return Err("Backups can only be restored on the Host PC.".into());
    }
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err(format!("Not a backup name: {name}"));
    }
    let paths = server_paths(&app)?;
    let backup = PathBuf::from(backup_dir).join(name);
    let server = Arc::clone(app.state::<Arc<HostServer>>().inner());
    tauri::async_runtime::spawn_blocking(move || {
        server.stop();
        let result = host::run_restore(&paths, &backup);
        server.start(paths);
        host::wait_until_ready(Duration::from_secs(120));
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hosts announced on the office network, as `[{ name, url }]`. Listens for 3 seconds.
#[tauri::command]
async fn discover_hosts() -> Result<Vec<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(|| discovery::discover(Duration::from_secs(3)))
        .await
        .map_err(|e| e.to_string())?
}

/// A Windows notification (the web app sends each new notification once).
#[tauri::command]
fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Puts this app in a Windows job that ends its child processes when the app ends, even after a
/// crash, so the Host server never outlives it (it would keep the port and the database open).
#[cfg(windows)]
fn end_children_with_app() -> Option<win32job::Job> {
    let job = win32job::Job::create().ok()?;
    let mut info = job.query_extended_limit_info().ok()?;
    info.limit_kill_on_job_close();
    job.set_extended_limit_info(&info).ok()?;
    job.assign_current_process().ok()?;
    Some(job)
}

fn main() {
    #[cfg(windows)]
    let _job = end_children_with_app();

    let app = tauri::Builder::default()
        // A second copy would start a second server on the same database; focus the first instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![MINIMIZED_ARG]),
        ))
        // Closing the window keeps the app (and a Host server) running in the tray. Quit is in the
        // tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .manage(Arc::new(HostServer::default()))
        .invoke_handler(tauri::generate_handler![
            get_mode,
            set_mode,
            start_host,
            discover_hosts,
            restore_backup,
            show_notification
        ])
        .setup(|app| {
            let started_minimized = std::env::args().any(|arg| arg == MINIMIZED_ARG);
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Whiteboard")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .visible(!started_minimized)
                .initialization_script(BRIDGE)
                .build()?;

            let open = MenuItem::with_id(app, "open", "Open Whiteboard", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Whiteboard", true, None::<&str>)?;
            TrayIconBuilder::with_id("main")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .ok_or("the app has no icon")?,
                )
                .tooltip("Whiteboard")
                .menu(&Menu::with_items(app, &[&open, &quit])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // Start the server right away rather than when the window first asks for it.
            if read_mode(app.handle()).as_deref() == Some("host") {
                app.state::<Arc<HostServer>>()
                    .start(server_paths(app.handle())?);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting Whiteboard");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            app.state::<Arc<HostServer>>().stop();
        }
    });
}
