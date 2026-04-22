use std::{env, process::ExitCode, str::FromStr};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde_json::json;
use spaces_protocol::slabel::SLabel;
use spaces_veritas::{Value, Veritas};

fn normalize_hex(input: &str) -> &str {
    input
        .strip_prefix("0x")
        .or_else(|| input.strip_prefix("0X"))
        .unwrap_or(input)
}

fn decode_hex<const N: usize>(input: &str, label: &str) -> Result<[u8; N], String> {
    let bytes = hex::decode(normalize_hex(input))
        .map_err(|error| format!("invalid {label} hex: {error}"))?;
    let arr: [u8; N] = bytes
        .try_into()
        .map_err(|_| format!("{label} must be {N} bytes"))?;
    Ok(arr)
}

fn output_json(value: serde_json::Value) -> ExitCode {
    println!(
        "{}",
        serde_json::to_string(&value).expect("serializing verifier json output")
    );
    ExitCode::SUCCESS
}

fn inspect(
    root_label: &str,
    proof_base64: &str,
    anchor_hex: &str,
) -> Result<serde_json::Value, String> {
    let anchor = decode_hex::<32>(anchor_hex, "anchor")?;
    let proof = BASE64
        .decode(proof_base64)
        .map_err(|error| format!("invalid proof base64: {error}"))?;

    let mut veritas = Veritas::new();
    veritas.add_anchor(anchor);

    let verified = veritas
        .verify_proof(&proof)
        .map_err(|error| format!("proof verification failed: {error:?}"))?;

    let canonical = if root_label.starts_with('@') {
        root_label.to_owned()
    } else {
        format!("@{root_label}")
    };
    SLabel::from_str(&canonical).map_err(|error| format!("invalid root label: {error}"))?;

    let proved_outpoint = verified.iter().find_map(|(_, value)| match value {
        Value::Outpoint(outpoint) => Some(outpoint),
        _ => None,
    });

    let proof_root_hash = hex::encode(verified.root());

    Ok(json!({
        "root_key_proof_verified": proved_outpoint.is_some(),
        "proved_outpoint": proved_outpoint.map(|outpoint| outpoint.to_string()),
        "root_pubkey": serde_json::Value::Null,
        "proof_root_hash": proof_root_hash,
        "failure_reason": serde_json::Value::Null,
    }))
}

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        eprintln!("usage: spaces-verifier-native inspect <root-label> <proof-base64> <anchor-hex>");
        return ExitCode::FAILURE;
    };

    let result = match command.as_str() {
        "inspect" => {
            let Some(root_label) = args.next() else {
                return ExitCode::FAILURE;
            };
            let Some(proof_base64) = args.next() else {
                return ExitCode::FAILURE;
            };
            let Some(anchor_hex) = args.next() else {
                return ExitCode::FAILURE;
            };
            inspect(&root_label, &proof_base64, &anchor_hex)
        }
        _ => Err(format!("unknown command: {command}")),
    };

    match result {
        Ok(value) => output_json(value),
        Err(error) => output_json(json!({
            "error": error,
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspect_example_proof_smoke_test() {
        let anchor_hex = "a44ad8bca3184798d75f69b9c50bfbc67dd1bcf550a9ce3a943ff6501ab60693";
        let proof_base64 = "AQEAAouXDhe+rJKxqcvRzRIthc2QkNuPDt34M2NmW8nLoqk0AQACD5+x6CJLkmxgKPTyS0Nq9Ci03Lev9Fm20W+kyCzvewMBAAEAAvNWZU+az0t38K0pMm5Ny5fWGFZskajtKZ+On2Z4PkGqAQACXb+CBVIEjx7wDHZbG/FWKuczR8WgyHSelZBwXIzjflIBAAJo/bDo+osV3y5G7AGeMv6i/LMbCozs2tk3jUg0+0L8nwEAAQABAAEAAiMCqoVnipJoF4xoNhz7owXgN+ozXdgce3MZX/M7WCXOAG4seB00O3x87+y2CM1e1uZhmTkmmkyUwyjxv/IronYzADcBAQdtZW1wb29sAfzA3gEAAPuaAiJRIHj13+6+2Wc7tWB+ZswSvzvEKCzhUjuwUsQyFJX0f8SHAklClIvNFftzNbqMoAe7bdDpm4pnWyU6o+abgq+22xEgAiNAa7W4k9sjy7lYKzZtx1ag2VVcz+XzwDLPZU02XiIDAqh+BDASBJSQYgMZPd/BAgbND21I/8FFfcpHsJqqsb4lAnHXQmQvzKYfAhWXtBD687lb4qqZudMBPZY0UQsqNWBC";

        let value = inspect("@mempool", proof_base64, anchor_hex).expect("inspect proof");

        assert!(value["root_key_proof_verified"].is_boolean());
        assert_eq!(
            value["proof_root_hash"],
            json!("a44ad8bca3184798d75f69b9c50bfbc67dd1bcf550a9ce3a943ff6501ab60693")
        );
    }
}
