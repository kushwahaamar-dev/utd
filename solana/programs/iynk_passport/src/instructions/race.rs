use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::error::PassportError;
use crate::events::{
    EntryRefunded, RaceCancelled, RaceCreated, RaceEntered, RacePayout, RaceSettled, ResultSubmitted,
};
use crate::state::{
    payouts, Config, Entry, Placing, Race, RaceStatus, CONFIG_SEED, ENTRY_SEED, RACE_SEED,
    SETTLE_GRACE_SECS,
};

fn is_finished(status: RaceStatus) -> bool {
    matches!(status, RaceStatus::Settled | RaceStatus::Cancelled)
}

// ---------------------------------------------------------------- create_race

#[derive(Accounts)]
#[instruction(race_id: u64)]
pub struct CreateRace<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        space = 8 + Race::INIT_SPACE,
        seeds = [RACE_SEED, race_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub race: Account<'info, Race>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_race(
    ctx: Context<CreateRace>,
    race_id: u64,
    entry_lamports: u64,
    track_hash: [u8; 32],
    closes_at: i64,
    seed_lamports: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(closes_at > now, PassportError::ClosesInPast);
    // A prize can land in a wallet that holds nothing else, and the runtime only
    // accepts that if it leaves the wallet rent-exempt. With an entry fee of at
    // least twice the empty-account minimum, the smallest possible share
    // (3/8 of two fees) clears it.
    require!(
        entry_lamports >= Rent::get()?.minimum_balance(0).checked_mul(2).ok_or(PassportError::Overflow)?,
        PassportError::EntryTooSmall
    );

    if seed_lamports > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.race.to_account_info(),
                },
            ),
            seed_lamports,
        )?;
    }

    let race = ctx.accounts.race.key();
    ctx.accounts.race.set_inner(Race {
        race_id,
        authority: ctx.accounts.config.issuer,
        creator: ctx.accounts.creator.key(),
        entry_lamports,
        seed_lamports,
        track_hash,
        closes_at,
        status: RaceStatus::Open,
        entry_count: 0,
        top3: [Placing::default(); 3],
        pot: seed_lamports,
        created_at: now,
        bump: ctx.bumps.race,
    });

    emit!(RaceCreated {
        race,
        race_id,
        creator: ctx.accounts.creator.key(),
        entry_lamports,
        seed_lamports,
        track_hash,
        closes_at,
    });
    Ok(())
}

// ----------------------------------------------------------------- enter_race

#[derive(Accounts)]
pub struct EnterRace<'info> {
    #[account(
        mut,
        seeds = [RACE_SEED, race.race_id.to_le_bytes().as_ref()],
        bump = race.bump,
    )]
    pub race: Account<'info, Race>,

    // `init` makes an entry one-per-player-per-race.
    #[account(
        init,
        payer = player,
        space = 8 + Entry::INIT_SPACE,
        seeds = [ENTRY_SEED, race.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub entry: Account<'info, Entry>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn enter_race(ctx: Context<EnterRace>) -> Result<()> {
    let race = &ctx.accounts.race;
    require!(race.status == RaceStatus::Open, PassportError::RaceNotOpen);
    require!(Clock::get()?.unix_timestamp < race.closes_at, PassportError::RaceClosed);
    let fee = race.entry_lamports;

    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.race.to_account_info(),
            },
        ),
        fee,
    )?;

    let race = &mut ctx.accounts.race;
    race.pot = race.pot.checked_add(fee).ok_or(PassportError::Overflow)?;
    race.entry_count = race.entry_count.checked_add(1).ok_or(PassportError::Overflow)?;

    ctx.accounts.entry.set_inner(Entry {
        race: race.key(),
        player: ctx.accounts.player.key(),
        lap_ms: 0,
        run_hash: [0; 32],
        verified: false,
        paid: false,
        bump: ctx.bumps.entry,
    });

    emit!(RaceEntered {
        race: race.key(),
        player: ctx.accounts.player.key(),
        entry_count: race.entry_count,
        pot: race.pot,
    });
    Ok(())
}

// -------------------------------------------------------------- submit_result

#[derive(Accounts)]
pub struct SubmitResult<'info> {
    #[account(
        mut,
        seeds = [RACE_SEED, race.race_id.to_le_bytes().as_ref()],
        bump = race.bump,
        has_one = authority @ PassportError::NotOracle,
    )]
    pub race: Account<'info, Race>,

    #[account(
        mut,
        seeds = [ENTRY_SEED, race.key().as_ref(), player.key().as_ref()],
        bump = entry.bump,
    )]
    pub entry: Account<'info, Entry>,

    /// CHECK: only names the entry; the entry PDA seeds prove it entered.
    pub player: UncheckedAccount<'info>,

    pub authority: Signer<'info>,
}

pub fn submit_result(ctx: Context<SubmitResult>, lap_ms: u32, run_hash: [u8; 32]) -> Result<()> {
    require!(lap_ms > 0, PassportError::InvalidLap);
    let race = &mut ctx.accounts.race;
    require!(!is_finished(race.status), PassportError::RaceFinished);

    let entry = &mut ctx.accounts.entry;
    let improved = entry.lap_ms == 0 || lap_ms < entry.lap_ms;
    let player = entry.player;
    let rank = if improved {
        entry.lap_ms = lap_ms;
        entry.run_hash = run_hash;
        entry.verified = true;
        race.place(Placing { player, lap_ms, run_hash })
    } else {
        race.top3.iter().position(|p| p.player == player).map(|i| i as u8)
    };

    emit!(ResultSubmitted {
        race: race.key(),
        player,
        lap_ms,
        run_hash,
        improved,
        rank: rank.unwrap_or(u8::MAX),
    });
    Ok(())
}

// ------------------------------------------------------------------ close_race

#[derive(Accounts)]
pub struct CloseRace<'info> {
    #[account(
        mut,
        seeds = [RACE_SEED, race.race_id.to_le_bytes().as_ref()],
        bump = race.bump,
        has_one = authority @ PassportError::NotOracle,
    )]
    pub race: Account<'info, Race>,

    pub authority: Signer<'info>,
}

/// Lets the oracle end entries early. Settling still waits for `closes_at`,
/// which this pulls forward to now.
pub fn close_race(ctx: Context<CloseRace>) -> Result<()> {
    let race = &mut ctx.accounts.race;
    require!(race.status == RaceStatus::Open, PassportError::RaceNotOpen);
    race.status = RaceStatus::Closed;
    race.closes_at = race.closes_at.min(Clock::get()?.unix_timestamp);
    Ok(())
}

// --------------------------------------------------------------------- settle

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [RACE_SEED, race.race_id.to_le_bytes().as_ref()],
        bump = race.bump,
    )]
    pub race: Account<'info, Race>,

    pub settler: Signer<'info>,
}

/// `remaining_accounts` holds one `(winner wallet, winner entry)` pair per
/// finisher on the podium (at most three), in podium order, all writable.
pub fn settle<'info>(ctx: Context<'_, '_, 'info, 'info, Settle<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let race = &mut ctx.accounts.race;
    require!(!is_finished(race.status), PassportError::RaceFinished);
    require!(now >= race.closes_at, PassportError::RaceNotClosed);
    if ctx.accounts.settler.key() != race.authority {
        let open_to_all = race.closes_at.checked_add(SETTLE_GRACE_SECS).ok_or(PassportError::Overflow)?;
        require!(now >= open_to_all, PassportError::SettleTooEarly);
    }

    let winners = race.finishers();
    require!(winners > 0, PassportError::NoFinishers);
    require!(ctx.remaining_accounts.len() == winners * 2, PassportError::BadPayoutAccounts);
    let shares = payouts(race.pot, winners).ok_or(PassportError::Overflow)?;
    let race_key = race.key();

    let mut paid_out = Vec::with_capacity(winners);
    for i in 0..winners {
        let wallet = &ctx.remaining_accounts[i * 2];
        let entry_info = &ctx.remaining_accounts[i * 2 + 1];
        require!(wallet.is_writable && entry_info.is_writable, PassportError::BadPayoutAccounts);
        require_keys_eq!(wallet.key(), race.top3[i].player, PassportError::PayoutMismatch);

        // Only this program writes accounts carrying the Entry discriminator, and
        // only at the entry PDA, so a successful load proves it is a real entry.
        let mut entry = Account::<Entry>::try_from(entry_info)?;
        require_keys_eq!(entry.race, race_key, PassportError::PayoutMismatch);
        require_keys_eq!(entry.player, race.top3[i].player, PassportError::PayoutMismatch);
        require!(!entry.paid, PassportError::EntryAlreadyPaid);

        race.sub_lamports(shares[i])?;
        wallet.add_lamports(shares[i])?;
        entry.paid = true;
        entry.exit(&crate::ID)?;
        paid_out.push(RacePayout { player: race.top3[i].player, amount: shares[i] });
    }

    let pot = race.pot;
    race.pot = 0;
    race.status = RaceStatus::Settled;
    let rent_floor = Rent::get()?.minimum_balance(8 + Race::INIT_SPACE);
    require!(race.get_lamports() >= rent_floor, PassportError::Overflow);

    emit!(RaceSettled { race: race_key, pot, payouts: paid_out });
    Ok(())
}

// ----------------------------------------------------------------- cancel_race

#[derive(Accounts)]
pub struct CancelRace<'info> {
    #[account(
        mut,
        seeds = [RACE_SEED, race.race_id.to_le_bytes().as_ref()],
        bump = race.bump,
    )]
    pub race: Account<'info, Race>,

    /// CHECK: receives the sponsor's seed back; must be the race creator.
    #[account(mut, address = race.creator @ PassportError::NotCreator)]
    pub creator: UncheckedAccount<'info>,

    pub signer: Signer<'info>,
}

/// The oracle can cancel any unfinished race. The creator can cancel only while
/// nobody has entered. The seed returns to the creator at once; entrants pull
/// their fee back with `refund_entry`.
pub fn cancel_race(ctx: Context<CancelRace>) -> Result<()> {
    let race = &mut ctx.accounts.race;
    require!(!is_finished(race.status), PassportError::RaceFinished);
    let signer = ctx.accounts.signer.key();
    if signer != race.authority {
        require_keys_eq!(signer, race.creator, PassportError::NotOracle);
        require!(race.entry_count == 0, PassportError::NotCreator);
    }

    let seed = race.pot.min(race.seed_lamports);
    race.sub_lamports(seed)?;
    ctx.accounts.creator.add_lamports(seed)?;
    race.pot = race.pot.checked_sub(seed).ok_or(PassportError::Overflow)?;
    race.status = RaceStatus::Cancelled;

    emit!(RaceCancelled { race: race.key(), refundable: race.pot });
    Ok(())
}

// ---------------------------------------------------------------- refund_entry

#[derive(Accounts)]
pub struct RefundEntry<'info> {
    #[account(
        mut,
        seeds = [RACE_SEED, race.race_id.to_le_bytes().as_ref()],
        bump = race.bump,
    )]
    pub race: Account<'info, Race>,

    #[account(
        mut,
        seeds = [ENTRY_SEED, race.key().as_ref(), player.key().as_ref()],
        bump = entry.bump,
    )]
    pub entry: Account<'info, Entry>,

    #[account(mut)]
    pub player: Signer<'info>,
}

pub fn refund_entry(ctx: Context<RefundEntry>) -> Result<()> {
    let race = &mut ctx.accounts.race;
    require!(race.status == RaceStatus::Cancelled, PassportError::RaceNotCancelled);
    let entry = &mut ctx.accounts.entry;
    require!(!entry.paid, PassportError::EntryAlreadyPaid);

    let amount = race.entry_lamports;
    race.sub_lamports(amount)?;
    ctx.accounts.player.add_lamports(amount)?;
    race.pot = race.pot.checked_sub(amount).ok_or(PassportError::Overflow)?;
    entry.paid = true;

    emit!(EntryRefunded { race: race.key(), player: ctx.accounts.player.key(), amount });
    Ok(())
}
