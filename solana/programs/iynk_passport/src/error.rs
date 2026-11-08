use anchor_lang::prelude::*;

#[error_code]
pub enum PassportError {
    #[msg("Only the program's upgrade authority can initialize the config")]
    NotUpgradeAuthority,
    #[msg("Only the config admin can do this")]
    NotAdmin,
    #[msg("Only the configured issuer can issue credentials")]
    NotIssuer,
    #[msg("Only the bounty's sponsor can cancel it")]
    NotSponsor,
    #[msg("skill_id must be 1 to 64 bytes")]
    SkillIdLength,
    #[msg("skill_id must be printable ASCII without spaces")]
    SkillIdCharset,
    #[msg("skill_hash must be sha256 of skill_id")]
    SkillHashMismatch,
    #[msg("The learner must be a wallet (an account owned by the System Program)")]
    LearnerNotWallet,
    #[msg("A bounty must hold at least the rent-exempt minimum of an empty account")]
    BountyTooSmall,
    #[msg("Bounty accounts must be passed as writable")]
    BountyNotWritable,
    #[msg("The bounty is for a different skill")]
    BountySkillMismatch,
    #[msg("The bounty is reserved for a different learner")]
    BountyLearnerMismatch,
    #[msg("The bounty has already been claimed")]
    BountyAlreadyClaimed,

    #[msg("Only the race's oracle can do this")]
    NotOracle,
    #[msg("The race is not open for entries")]
    RaceNotOpen,
    #[msg("The race has closed")]
    RaceClosed,
    #[msg("The race has not closed yet")]
    RaceNotClosed,
    #[msg("The race is already settled or cancelled")]
    RaceFinished,
    #[msg("The race is not cancelled")]
    RaceNotCancelled,
    #[msg("closes_at must be in the future")]
    ClosesInPast,
    #[msg("The entry fee is below the minimum for a race")]
    EntryTooSmall,
    #[msg("lap_ms must be greater than zero")]
    InvalidLap,
    #[msg("Nobody has a verified result yet")]
    NoFinishers,
    #[msg("Only the oracle can settle until the grace period after closing has passed")]
    SettleTooEarly,
    #[msg("settle needs one (wallet, entry) pair of writable accounts per podium place")]
    BadPayoutAccounts,
    #[msg("A payout account does not match the podium")]
    PayoutMismatch,
    #[msg("This entry was already paid or refunded")]
    EntryAlreadyPaid,
    #[msg("Only the creator can cancel a race, and only before anyone enters")]
    NotCreator,
    #[msg("Arithmetic overflow")]
    Overflow,
}
