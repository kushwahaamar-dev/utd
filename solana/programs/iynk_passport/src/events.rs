use anchor_lang::prelude::*;

#[event]
pub struct CredentialIssued {
    pub learner: Pubkey,
    pub skill_id: String,
    pub replay_hash: [u8; 32],
    pub score: u16,
}

#[event]
pub struct BountyPaid {
    pub bounty: Pubkey,
    pub learner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RaceCreated {
    pub race: Pubkey,
    pub race_id: u64,
    pub creator: Pubkey,
    pub entry_lamports: u64,
    pub seed_lamports: u64,
    pub track_hash: [u8; 32],
    pub closes_at: i64,
}

#[event]
pub struct RaceEntered {
    pub race: Pubkey,
    pub player: Pubkey,
    pub entry_count: u32,
    pub pot: u64,
}

#[event]
pub struct ResultSubmitted {
    pub race: Pubkey,
    pub player: Pubkey,
    pub lap_ms: u32,
    pub run_hash: [u8; 32],
    /// False when the player already had a faster verified lap.
    pub improved: bool,
    /// Zero-based podium rank after this result, or 255 when outside the top three.
    pub rank: u8,
}

#[event]
pub struct RacePayout {
    pub player: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RaceSettled {
    pub race: Pubkey,
    pub pot: u64,
    pub payouts: Vec<RacePayout>,
}

#[event]
pub struct RaceCancelled {
    pub race: Pubkey,
    pub refundable: u64,
}

#[event]
pub struct EntryRefunded {
    pub race: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
}
