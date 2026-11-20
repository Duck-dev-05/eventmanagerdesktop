use sha2::{Digest, Sha256};

pub fn hash_password(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let result = hasher.finalize();
    format!("sha256:{}", hex::encode(result))
}

pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    if !stored_hash.starts_with("sha256:") {
        return password == stored_hash;
    }
    let hex_hash = &stored_hash[7..];
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let result = hasher.finalize();
    hex::encode(result) == hex_hash
}
