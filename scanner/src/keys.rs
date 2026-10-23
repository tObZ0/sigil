//! Everything the scanner knows about keys. It holds only a full viewing key:
//! it can derive deposit addresses and recognise payments to them, and it
//! cannot spend a single zatoshi.

use anyhow::{anyhow, Context, Result};
use orchard::{
    keys::{FullViewingKey, IncomingViewingKey, PreparedIncomingViewingKey, Scope},
    note::{ExtractedNoteCommitment, Nullifier},
    note_encryption::{CompactAction, IronwoodDomain, OrchardDomain},
};
use zcash_address::unified::{self, Container, Encoding, Fvk, Receiver, Revision, Ufvk, Uitem};
use zcash_note_encryption::{try_compact_note_decryption, EphemeralKeyBytes};
use zcash_protocol::consensus::NetworkType;

use crate::rpc::CompactOrchardAction;

pub struct Keys {
    fvk: FullViewingKey,
    ivk: IncomingViewingKey,
    prepared: PreparedIncomingViewingKey,
    pub network: NetworkType,
}

/// A note that decrypted under our key.
pub struct Received {
    /// Diversifier index of the address it was sent to: the order's slot.
    pub index: u64,
    pub zatoshis: u64,
}

impl Keys {
    pub fn from_ufvk(encoded: &str) -> Result<Self> {
        let (network, _revision, ufvk) =
            Ufvk::decode(encoded.trim()).map_err(|e| anyhow!("not a unified full viewing key: {e}"))?;
        let raw = ufvk
            .items()
            .into_iter()
            .find_map(|item| match item {
                Fvk::Orchard(bytes) => Some(bytes),
                _ => None,
            })
            .context("this viewing key has no Orchard part; export a UFVK from an Orchard wallet")?;
        let fvk = FullViewingKey::from_bytes(&raw).context("Orchard viewing key bytes are invalid")?;
        let ivk = fvk.to_ivk(Scope::External);
        let prepared = PreparedIncomingViewingKey::new(&ivk);
        Ok(Self { fvk, ivk, prepared, network })
    }

    pub fn network_name(&self) -> &'static str {
        match self.network {
            NetworkType::Main => "main",
            NetworkType::Test => "test",
            NetworkType::Regtest => "regtest",
        }
    }

    /// Orchard-only unified address at a diversifier index. Every order gets
    /// its own index, so a payment identifies its order without a memo.
    ///
    /// Encoded as revision 0 (`u1…`), which every shielded wallet can pay.
    /// Revision 2 (`zu…`) adds nothing we use and older wallets reject it.
    pub fn address(&self, index: u64) -> String {
        let addr = self.fvk.address_at(index, Scope::External);
        let receivers = vec![Uitem::Data(Receiver::Orchard(addr.to_raw_address_bytes()))];
        unified::Address::try_from_items(Revision::R0, receivers)
            .expect("one Orchard receiver is a valid unified address")
            .encode(&self.network)
    }

    /// Trial-decrypts one compact action. `None` means it isn't ours
    /// (or is malformed, which we treat the same way).
    pub fn decrypt(&self, action: &CompactOrchardAction) -> Option<Received> {
        let nf: [u8; 32] = action.nullifier.as_slice().try_into().ok()?;
        let cmx: [u8; 32] = action.cmx.as_slice().try_into().ok()?;
        let epk: [u8; 32] = action.ephemeral_key.as_slice().try_into().ok()?;
        let ciphertext: [u8; 52] = action.ciphertext.as_slice().try_into().ok()?;

        let nf = Option::from(Nullifier::from_bytes(&nf))?;
        let cmx = Option::from(ExtractedNoteCommitment::from_bytes(&cmx))?;
        let compact = CompactAction::from_parts(nf, cmx, EphemeralKeyBytes(epk), ciphertext);

        // Classic Orchard notes (V2), then Ironwood notes (V3, ZIP 2005) that
        // wallets switch to after the upgrade. Same keys and addresses; only
        // the plaintext version differs, and missing either means missing money.
        let (note, address) = try_compact_note_decryption(
            &OrchardDomain::for_compact_action(&compact),
            &self.prepared,
            &compact,
        )
        .or_else(|| {
            try_compact_note_decryption(&IronwoodDomain::for_compact_action(&compact), &self.prepared, &compact)
        })?;
        let index = self.ivk.diversifier_index(&address)?;

        // Indices we hand out fit in a u64; anything wider wasn't issued by us.
        let bytes = index.as_bytes();
        if bytes[8..].iter().any(|b| *b != 0) {
            return None;
        }
        let index = u64::from_le_bytes(bytes[..8].try_into().ok()?);
        Some(Received { index, zatoshis: note.value().inner() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use orchard::{
        keys::SpendingKey,
        note::{Note, NoteVersion, RandomSeed, Rho},
        value::NoteValue,
    };
    use zcash_note_encryption::{Domain, NoteEncryption};

    const SLOT: u64 = 1_000_000;

    fn wallet() -> (SpendingKey, Keys) {
        let sk = Option::from(SpendingKey::from_bytes([7; 32])).expect("valid spending key");
        let fvk = FullViewingKey::from(&sk);
        let ufvk = Ufvk::try_from_items(Revision::R0, vec![Uitem::Data(Fvk::Orchard(fvk.to_bytes()))])
            .unwrap()
            .encode(&NetworkType::Main);
        assert!(ufvk.starts_with("uview1"));
        (sk, Keys::from_ufvk(&ufvk).unwrap())
    }

    /// Encrypts a note the way a sender's wallet does and returns the
    /// compact action lightwalletd would serve for it.
    fn pay<D>(to: orchard::Address, zatoshis: u64, version: NoteVersion) -> CompactOrchardAction
    where
        D: Domain<Note = Note, Recipient = orchard::Address, Memo = [u8; 512]>,
        D::NoteCiphertextBytes: AsRef<[u8]>,
    {
        // A compact action's rho is its nullifier; any small field element works.
        let mut nf = [0u8; 32];
        nf[0] = 9;
        let rho = Option::from(Rho::from_bytes(&nf)).unwrap();
        let note: Note = (0u8..=255)
            .find_map(|i| {
                let rseed = Option::<RandomSeed>::from(RandomSeed::from_bytes([i; 32], &rho))?;
                Option::from(Note::from_parts(to, NoteValue::from_raw(zatoshis), rho, rseed, version))
            })
            .expect("some seed makes a valid note");
        let cmx = ExtractedNoteCommitment::from(note.commitment()).to_bytes();
        let enc = NoteEncryption::<D>::new(None, note, [0; 512]);
        let ciphertext = enc.encrypt_note_plaintext();
        CompactOrchardAction {
            nullifier: nf.to_vec(),
            cmx: cmx.to_vec(),
            ephemeral_key: D::epk_bytes(enc.epk()).0.to_vec(),
            ciphertext: ciphertext.as_ref()[..52].to_vec(),
        }
    }

    #[test]
    fn finds_orchard_payment_to_an_order_slot() {
        let (sk, keys) = wallet();
        let to = FullViewingKey::from(&sk).address_at(SLOT, Scope::External);
        let got = keys.decrypt(&pay::<OrchardDomain>(to, 150_000_000, NoteVersion::V2)).expect("ours");
        assert_eq!((got.index, got.zatoshis), (SLOT, 150_000_000));
    }

    #[test]
    fn finds_ironwood_payment_too() {
        let (sk, keys) = wallet();
        let to = FullViewingKey::from(&sk).address_at(SLOT + 1, Scope::External);
        let got = keys.decrypt(&pay::<IronwoodDomain>(to, 5_000_000, NoteVersion::V3)).expect("ours");
        assert_eq!((got.index, got.zatoshis), (SLOT + 1, 5_000_000));
    }

    #[test]
    fn ignores_payments_to_someone_else() {
        let (_, keys) = wallet();
        let stranger = Option::from(SpendingKey::from_bytes([8; 32])).map(|sk: SpendingKey| FullViewingKey::from(&sk)).unwrap();
        let to = stranger.address_at(SLOT, Scope::External);
        assert!(keys.decrypt(&pay::<OrchardDomain>(to, 1, NoteVersion::V2)).is_none());
    }

    #[test]
    fn address_is_a_mainnet_u1_that_decodes_back_to_the_slot() {
        let (sk, keys) = wallet();
        let ua = keys.address(SLOT);
        assert!(ua.starts_with("u1"), "{ua}");
        let (net, _, decoded) = unified::Address::decode(&ua).unwrap();
        assert_eq!(net, NetworkType::Main);
        let expected = FullViewingKey::from(&sk).address_at(SLOT, Scope::External).to_raw_address_bytes();
        assert_eq!(decoded.items(), vec![Receiver::Orchard(expected)]);
    }

    #[test]
    fn rejects_garbage_keys() {
        assert!(Keys::from_ufvk("uview1nope").is_err());
        assert!(Keys::from_ufvk("").is_err());
    }
}

/// `cargo test -- --ignored --nocapture throwaway` prints a mainnet viewing
/// key nobody can spend from, for running the scanner live in development.
#[cfg(test)]
#[test]
#[ignore]
fn throwaway_ufvk() {
    let sk: orchard::keys::SpendingKey = Option::from(orchard::keys::SpendingKey::from_bytes([42; 32])).unwrap();
    let fvk = FullViewingKey::from(&sk);
    let ufvk = Ufvk::try_from_items(Revision::R0, vec![Uitem::Data(Fvk::Orchard(fvk.to_bytes()))]).unwrap();
    println!("RELAY_UFVK={}", ufvk.encode(&NetworkType::Main));
}
