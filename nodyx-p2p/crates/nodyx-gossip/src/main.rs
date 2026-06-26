//! nodyx-gossip : decouverte de pairs Nodyx par gossip. Zero dependance.
//!
//! Usage :
//!   nodyx-gossip --slug <slug> --port <port> [--bootstrap addr1,addr2,...]
//!
//! Demo : lancer 3 noeuds ; B et C ne connaissent que A au demarrage, puis se
//! decouvrent mutuellement par gossip. On coupe A : B et C continuent a se voir.

mod node;
mod protocol;

use node::Node;

fn main() -> std::io::Result<()> {
    let mut slug: Option<String> = None;
    let mut port: Option<u16> = None;
    let mut bootstrap: Vec<String> = Vec::new();

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--slug" => slug = args.next(),
            "--port" => port = args.next().and_then(|p| p.parse().ok()),
            "--bootstrap" => {
                if let Some(v) = args.next() {
                    bootstrap = v.split(',').filter(|s| !s.is_empty()).map(String::from).collect();
                }
            }
            "-h" | "--help" => {
                println!("nodyx-gossip --slug <slug> --port <port> [--bootstrap addr1,addr2]");
                return Ok(());
            }
            other => eprintln!("argument ignore: {other}"),
        }
    }

    let slug = slug.unwrap_or_else(|| {
        eprintln!("erreur: --slug est requis");
        std::process::exit(2);
    });
    let port = port.unwrap_or_else(|| {
        eprintln!("erreur: --port est requis");
        std::process::exit(2);
    });

    Node::bind(slug, port, bootstrap)?.run()
}
