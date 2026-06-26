//! Format de fil gossip, fait maison, sans serde.
//!
//! Un datagramme est du texte UTF-8 :
//! ```text
//! NDX1
//! <expediteur>
//! <pair 1>
//! <pair 2>
//! ...
//! ```
//! Chaque ligne de pair : `node_id|slug|addr|heartbeat`. Lisible, debuggable,
//! zero dependance.

/// Ce qu'on sait d'un noeud du reseau Nodyx.
/// `heartbeat` (epoch secondes) est rafraichi par le noeud lui-meme a chaque
/// tour : c'est la mesure de fraicheur qui permet l'auto-guerison (un noeud qui
/// ne se rafraichit plus vieillit puis disparait des tables, cf. PEER_TTL_SECS).
#[derive(Clone, Debug, PartialEq)]
pub struct PeerInfo {
    pub node_id: String,
    pub slug: String,
    pub addr: String,
    pub heartbeat: u64,
}

impl PeerInfo {
    pub fn encode(&self) -> String {
        format!("{}|{}|{}|{}", self.node_id, self.slug, self.addr, self.heartbeat)
    }

    pub fn decode(line: &str) -> Option<PeerInfo> {
        // splitn(4) : node_id, slug, addr ne peuvent pas contenir '|' ; heartbeat
        // est le reste mais doit parser en u64, donc pas de '|' non plus.
        let mut it = line.splitn(4, '|');
        let node_id = it.next()?.to_string();
        let slug = it.next()?.to_string();
        let addr = it.next()?.to_string();
        let heartbeat = it.next()?.parse().ok()?;
        if node_id.is_empty() || slug.is_empty() || addr.is_empty() {
            return None;
        }
        Some(PeerInfo { node_id, slug, addr, heartbeat })
    }
}

const MAGIC: &str = "NDX1";

/// Serialise un message gossip : magic, expediteur, puis pairs connus.
pub fn encode_gossip(from: &PeerInfo, peers: &[PeerInfo]) -> Vec<u8> {
    let mut s = String::with_capacity(64 + peers.len() * 64);
    s.push_str(MAGIC);
    s.push('\n');
    s.push_str(&from.encode());
    for p in peers {
        s.push('\n');
        s.push_str(&p.encode());
    }
    s.into_bytes()
}

/// Parse un message gossip. Retourne (expediteur, pairs connus).
pub fn decode_gossip(bytes: &[u8]) -> Option<(PeerInfo, Vec<PeerInfo>)> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut lines = text.lines();
    if lines.next()? != MAGIC {
        return None;
    }
    let from = PeerInfo::decode(lines.next()?)?;
    let peers = lines.filter_map(PeerInfo::decode).collect();
    Some((from, peers))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let from = PeerInfo { node_id: "abcd".into(), slug: "alice".into(), addr: "127.0.0.1:9001".into(), heartbeat: 42 };
        let peers = vec![
            PeerInfo { node_id: "ef01".into(), slug: "bob".into(), addr: "127.0.0.1:9002".into(), heartbeat: 41 },
        ];
        let bytes = encode_gossip(&from, &peers);
        let (f, p) = decode_gossip(&bytes).expect("doit parser");
        assert_eq!(f, from);
        assert_eq!(p, peers);
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode_gossip(b"pas du nodyx").is_none());
        assert!(PeerInfo::decode("trop|peu").is_none());
        assert!(PeerInfo::decode("a|b|c|pasunnombre").is_none());
    }
}
