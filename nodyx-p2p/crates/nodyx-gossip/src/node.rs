//! Noeud de decouverte par gossip. std uniquement : un socket UDP, deux fils.
//!
//! Anti-entropie epidemique : a chaque tour, le noeud envoie "voici qui je suis
//! + tous ceux que je connais" a quelques pairs au hasard. L'info se propage
//! sans aucun serveur central. Les noeuds qui ne se rafraichissent plus
//! vieillissent et disparaissent (auto-guerison).

use crate::protocol::{decode_gossip, encode_gossip, PeerInfo};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const GOSSIP_INTERVAL: Duration = Duration::from_secs(2);
const PEER_TTL_SECS: u64 = 15; // un noeud non rafraichi depuis 15s est considere mort
const FANOUT: usize = 3; // nombre de pairs contactes a chaque tour

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

/// PRNG minimal (xorshift64). Fait maison, pas de crate `rand`.
fn xorshift(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    x
}

fn gen_node_id() -> String {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64;
    let pid = std::process::id() as u64;
    let mut s = (t ^ pid.wrapping_mul(0x9E37_79B9_7F4A_7C15)) | 1;
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    format!("{s:016x}")
}

fn shuffle(v: &mut [String], rng: &mut u64) {
    for i in (1..v.len()).rev() {
        let j = (xorshift(rng) as usize) % (i + 1);
        v.swap(i, j);
    }
}

/// Fusionne des pairs entrants dans la table locale.
/// On ne s'ajoute jamais soi-meme ; on ne garde que l'info la plus fraiche.
fn merge(table: &mut HashMap<String, PeerInfo>, me_id: &str, incoming: impl Iterator<Item = PeerInfo>) {
    for p in incoming {
        if p.node_id == me_id {
            continue;
        }
        match table.get(&p.node_id) {
            Some(existing) if existing.heartbeat >= p.heartbeat => {}
            _ => {
                table.insert(p.node_id.clone(), p);
            }
        }
    }
}

pub struct Node {
    me: PeerInfo,
    peers: Arc<Mutex<HashMap<String, PeerInfo>>>,
    socket: UdpSocket,
    bootstrap: Vec<String>,
}

impl Node {
    pub fn bind(slug: String, port: u16, bootstrap: Vec<String>) -> std::io::Result<Self> {
        let socket = UdpSocket::bind(("0.0.0.0", port))?;
        let slug: String = slug.chars().filter(|c| *c != '|' && *c != '\n' && *c != '\r').collect();
        let me = PeerInfo {
            node_id: gen_node_id(),
            slug,
            addr: format!("127.0.0.1:{port}"),
            heartbeat: now_secs(),
        };
        Ok(Self {
            me,
            peers: Arc::new(Mutex::new(HashMap::new())),
            socket,
            bootstrap,
        })
    }

    pub fn run(self) -> std::io::Result<()> {
        println!(
            "[{}] noeud {} demarre sur {} ({} bootstrap)",
            self.me.slug,
            &self.me.node_id[..8],
            self.me.addr,
            self.bootstrap.len()
        );

        // Fil de reception : fusionne tout ce qu'on recoit.
        let rx_socket = self.socket.try_clone()?;
        let rx_peers = self.peers.clone();
        let rx_me = self.me.node_id.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let Ok((n, _from)) = rx_socket.recv_from(&mut buf) else {
                    continue;
                };
                if let Some((from, incoming)) = decode_gossip(&buf[..n]) {
                    if let Ok(mut table) = rx_peers.lock() {
                        merge(&mut table, &rx_me, std::iter::once(from).chain(incoming));
                    }
                }
            }
        });

        // Fil d'emission : prune les morts, rafraichit mon heartbeat, gossipe.
        let mut rng = now_secs().wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        loop {
            std::thread::sleep(GOSSIP_INTERVAL);

            let snapshot: Vec<PeerInfo> = {
                let mut table = self.peers.lock().unwrap();
                let cutoff = now_secs().saturating_sub(PEER_TTL_SECS);
                table.retain(|_, p| p.heartbeat >= cutoff);
                table.values().cloned().collect()
            };

            let mut me = self.me.clone();
            me.heartbeat = now_secs();
            let bytes = encode_gossip(&me, &snapshot);

            // Cibles : bootstrap + pairs connus, tirage au hasard, FANOUT max.
            let mut targets: Vec<String> = self.bootstrap.clone();
            targets.extend(snapshot.iter().map(|p| p.addr.clone()));
            shuffle(&mut targets, &mut rng);
            for addr in targets.iter().take(FANOUT) {
                let _ = self.socket.send_to(&bytes, addr.as_str());
            }

            let list: Vec<String> = snapshot.iter().map(|p| format!("{}@{}", p.slug, p.addr)).collect();
            println!("[{}] connait {} pair(s): {}", self.me.slug, snapshot.len(), list.join(", "));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(id: &str, hb: u64) -> PeerInfo {
        PeerInfo { node_id: id.into(), slug: id.into(), addr: "127.0.0.1:1".into(), heartbeat: hb }
    }

    #[test]
    fn merge_ignore_self() {
        let mut t = HashMap::new();
        merge(&mut t, "me", std::iter::once(peer("me", 10)));
        assert!(t.is_empty(), "un noeud ne doit jamais s'ajouter lui-meme");
    }

    #[test]
    fn merge_keeps_freshest() {
        let mut t = HashMap::new();
        merge(&mut t, "me", std::iter::once(peer("a", 10)));
        merge(&mut t, "me", std::iter::once(peer("a", 5))); // plus vieux -> ignore
        assert_eq!(t.get("a").unwrap().heartbeat, 10);
        merge(&mut t, "me", std::iter::once(peer("a", 20))); // plus frais -> remplace
        assert_eq!(t.get("a").unwrap().heartbeat, 20);
    }

    #[test]
    fn merge_adds_new_peers() {
        let mut t = HashMap::new();
        merge(&mut t, "me", vec![peer("a", 1), peer("b", 1)].into_iter());
        assert_eq!(t.len(), 2);
    }
}
