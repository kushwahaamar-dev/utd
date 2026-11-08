use anchor_lang::prelude::*;

use crate::skill::MAX_SKILL_ID_LEN;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const CREDENTIAL_SEED: &[u8] = b"cred";
#[constant]
pub const BOUNTY_SEED: &[u8] = b"bounty";

/// PDA ["config"].
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub issuer: Pubkey,
    pub bump: u8,
}

/// PDA ["cred", learner, skill_hash]. One per learner and skill; never transferable.
#[account]
#[derive(InitSpace)]
pub struct Credential {
    pub learner: Pubkey,
    pub skill_hash: [u8; 32],
    #[max_len(MAX_SKILL_ID_LEN)]
    pub skill_id: String,
    pub replay_hash: [u8; 32],
    pub score: u16,
    pub issued_at: i64,
    pub issuer: Pubkey,
    pub bump: u8,
}

/// PDA ["bounty", sponsor, skill_hash, nonce as u64 little-endian].
/// Holds its rent plus `amount` lamports until it is claimed or cancelled.
#[account]
#[derive(InitSpace)]
pub struct Bounty {
    pub sponsor: Pubkey,
    pub skill_hash: [u8; 32],
    #[max_len(MAX_SKILL_ID_LEN)]
    pub skill_id: String,
    pub learner: Option<Pubkey>,
    pub amount: u64,
    pub created_at: i64,
    pub claimed_by: Option<Pubkey>,
    pub nonce: u64,
    pub bump: u8,
}

#[constant]
pub const RACE_SEED: &[u8] = b"race";
#[constant]
pub const ENTRY_SEED: &[u8] = b"entry";

/// How long after `closes_at` only the oracle may settle. After that anyone can.
pub const SETTLE_GRACE_SECS: i64 = 3600;

/// Prize split in percent for first, second and third place.
pub const PRIZE_WEIGHTS: [u64; 3] = [50, 30, 20];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum RaceStatus {
    Open,
    Closed,
    Settled,
    Cancelled,
}

/// One slot of the podium. `lap_ms == 0` means the slot is empty.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug, InitSpace)]
pub struct Placing {
    pub player: Pubkey,
    pub lap_ms: u32,
    pub run_hash: [u8; 32],
}

/// PDA ["race", race_id as u64 little-endian].
/// Holds its rent plus `pot` lamports (seed plus entry fees) until it settles or cancels.
#[account]
#[derive(InitSpace)]
pub struct Race {
    pub race_id: u64,
    /// The oracle (the config issuer when the race was created) that submits results.
    pub authority: Pubkey,
    pub creator: Pubkey,
    pub entry_lamports: u64,
    pub seed_lamports: u64,
    pub track_hash: [u8; 32],
    pub closes_at: i64,
    pub status: RaceStatus,
    pub entry_count: u32,
    pub top3: [Placing; 3],
    pub pot: u64,
    pub created_at: i64,
    pub bump: u8,
}

/// PDA ["entry", race, player]. One per player and race.
#[account]
#[derive(InitSpace)]
pub struct Entry {
    pub race: Pubkey,
    pub player: Pubkey,
    /// Best verified lap in milliseconds, 0 until a result is submitted.
    pub lap_ms: u32,
    pub run_hash: [u8; 32],
    pub verified: bool,
    /// Set once the player has been paid a prize or refunded.
    pub paid: bool,
    pub bump: u8,
}

impl Race {
    pub fn finishers(&self) -> usize {
        self.top3.iter().filter(|p| p.lap_ms > 0).count()
    }

    /// Puts `placing` on the podium (replacing the player's earlier slot, if any),
    /// keeping it ordered by lap time. Ties keep the earlier finisher ahead.
    /// Returns the zero-based rank, or None when it did not make the top three.
    pub fn place(&mut self, placing: Placing) -> Option<u8> {
        let mut list: Vec<Placing> = self
            .top3
            .iter()
            .copied()
            .filter(|p| p.lap_ms > 0 && p.player != placing.player)
            .collect();
        let at = list.iter().position(|p| placing.lap_ms < p.lap_ms).unwrap_or(list.len());
        list.insert(at, placing);
        list.truncate(3);
        self.top3 = [Placing::default(); 3];
        for (slot, p) in self.top3.iter_mut().zip(list.iter()) {
            *slot = *p;
        }
        list.iter().position(|p| p.player == placing.player).map(|i| i as u8)
    }
}

/// Splits `pot` between `winners` podium places (1 to 3) by the 50/30/20 weights,
/// renormalised over the places that exist. First place takes the rounding dust,
/// so the parts always add up to `pot` exactly. None on overflow.
pub fn payouts(pot: u64, winners: usize) -> Option<[u64; 3]> {
    let winners = winners.clamp(1, 3);
    let total: u64 = PRIZE_WEIGHTS[..winners].iter().sum();
    let mut out = [0u64; 3];
    let mut paid_rest = 0u64;
    for i in 1..winners {
        out[i] = (u128::from(pot) * u128::from(PRIZE_WEIGHTS[i]) / u128::from(total)) as u64;
        paid_rest = paid_rest.checked_add(out[i])?;
    }
    out[0] = pot.checked_sub(paid_rest)?;
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn race() -> Race {
        Race {
            race_id: 1,
            authority: Pubkey::default(),
            creator: Pubkey::default(),
            entry_lamports: 0,
            seed_lamports: 0,
            track_hash: [0; 32],
            closes_at: 0,
            status: RaceStatus::Open,
            entry_count: 0,
            top3: [Placing::default(); 3],
            pot: 0,
            created_at: 0,
            bump: 0,
        }
    }

    fn placing(n: u8, lap_ms: u32) -> Placing {
        Placing { player: Pubkey::new_from_array([n; 32]), lap_ms, run_hash: [n; 32] }
    }

    #[test]
    fn payouts_sum_to_pot() {
        for pot in [0u64, 1, 7, 100, 1_000_003, u64::MAX] {
            for w in 1..=3 {
                let p = payouts(pot, w).unwrap();
                assert_eq!(p.iter().map(|x| u128::from(*x)).sum::<u128>(), u128::from(pot));
            }
        }
        assert_eq!(payouts(1000, 3).unwrap(), [500, 300, 200]);
        assert_eq!(payouts(800, 2).unwrap(), [500, 300, 0]);
        assert_eq!(payouts(1000, 1).unwrap(), [1000, 0, 0]);
    }

    #[test]
    fn podium_orders_and_replaces() {
        let mut r = race();
        assert_eq!(r.place(placing(1, 9000)), Some(0));
        assert_eq!(r.place(placing(2, 8000)), Some(0));
        assert_eq!(r.place(placing(3, 8500)), Some(1));
        assert_eq!(r.place(placing(4, 9500)), None);
        assert_eq!(r.place(placing(4, 7000)), Some(0));
        let order: Vec<u32> = r.top3.iter().map(|p| p.lap_ms).collect();
        assert_eq!(order, vec![7000, 8000, 8500]);
        // A player improving moves up and never appears twice.
        assert_eq!(r.place(placing(3, 6000)), Some(0));
        assert_eq!(r.top3.iter().filter(|p| p.player == placing(3, 0).player).count(), 1);
        assert_eq!(r.finishers(), 3);
        // A tie keeps the earlier finisher ahead.
        assert_eq!(r.place(placing(2, 6000)), Some(1));
    }
}
