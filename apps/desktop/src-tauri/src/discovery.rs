//! Finds Hosts announced on the office network (mDNS `_whiteboard._tcp`, announced by
//! apps/server/src/discovery.ts).

use std::collections::BTreeMap;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde_json::{json, Value};

const SERVICE: &str = "_whiteboard._tcp.local.";

/// Listens for `wait` and returns `{ name, url }` for each Host that answered, sorted by address.
pub fn discover(wait: Duration) -> Result<Vec<Value>, String> {
    let mdns = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let events = mdns.browse(SERVICE).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + wait;
    let mut found = BTreeMap::new(); // url -> name; one entry even if a Host answers twice
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match events.recv_timeout(left) {
            Ok(ServiceEvent::ServiceResolved(service)) => {
                if let Some(ip) = reachable_address(service.get_addresses_v4(), service.port) {
                    let suffix = format!(".{SERVICE}");
                    let name = service
                        .fullname
                        .strip_suffix(&suffix)
                        .unwrap_or(&service.fullname);
                    found.insert(format!("http://{ip}:{}", service.port), name.to_string());
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = mdns.shutdown();
    Ok(found
        .into_iter()
        .map(|(url, name)| json!({ "name": name, "url": url }))
        .collect())
}

/// A Host PC often also has virtual adapters (WSL, Hyper-V, VirtualBox) whose addresses other PCs
/// cannot reach. Try office LAN ranges first and keep the first address that accepts a connection.
/// IPv6 is skipped: office LANs use IPv4, and link-local IPv6 would need a zone id in the URL.
fn reachable_address(addresses: impl IntoIterator<Item = Ipv4Addr>, port: u16) -> Option<Ipv4Addr> {
    let mut candidates: Vec<Ipv4Addr> = addresses.into_iter().collect();
    candidates.sort_by_key(|ip| {
        let [a, b, ..] = ip.octets();
        match (a, b) {
            (192, 168) => 0,
            (10, _) => 1,
            (172, 16..=31) => 2,
            _ => 3,
        }
    });
    candidates.into_iter().find(|ip| {
        TcpStream::connect_timeout(&SocketAddr::from((*ip, port)), Duration::from_millis(300))
            .is_ok()
    })
}
