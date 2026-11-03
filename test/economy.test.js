import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addMessageXp,
  credit,
  economyLeaderboardFor,
  getCooldownRemaining,
  leaderboardFor,
  levelForXp,
  normalizeEconomyState,
  normalizeProfile,
  rankFor,
  xpProgress,
  xpRequiredForLevel,
  XP_COOLDOWN_MS,
  WORK_COOLDOWN_MS,
} from '../economy.js';

test('Arcane-style XP curve calculates level thresholds and progress', () => {
  assert.equal(xpRequiredForLevel(0), 0);
  assert.equal(xpRequiredForLevel(1), 100);
  assert.equal(xpRequiredForLevel(2), 255);
  assert.equal(levelForXp(99), 0);
  assert.equal(levelForXp(100), 1);
  assert.equal(levelForXp(254), 1);
  assert.equal(levelForXp(255), 2);
  assert.deepEqual(xpProgress(125), { level: 1, current: 25, needed: 155 });
});

test('chat XP cooldown blocks spam and reports level-ups', () => {
  const profile = normalizeProfile();
  assert.deepEqual(addMessageXp(profile, 100_000, 100), {
    amount: 100,
    level: 1,
    current: 0,
    needed: 155,
    leveledUp: true,
  });
  assert.equal(addMessageXp(profile, 100_000 + XP_COOLDOWN_MS - 1, 25), null);
  const next = addMessageXp(profile, 100_000 + XP_COOLDOWN_MS, 25);
  assert.equal(next.level, 1);
  assert.equal(next.current, 25);
  assert.equal(next.leveledUp, false);
  assert.equal(profile.xp, 125);
});

test('money credit is bounded and rejects invalid accounts or amounts', () => {
  const profile = normalizeProfile({ wallet: 1_000_000_000_000 - 10 });
  assert.equal(credit(profile, 'wallet', 25), 10);
  assert.equal(profile.wallet, 1_000_000_000_000);
  assert.throws(() => credit(profile, 'xp', 10), /wallet or bank/);
  assert.throws(() => credit(profile, 'bank', -1), /non-negative/);
});

test('state normalization retains other state while cleaning economy profiles', () => {
  const state = normalizeEconomyState({
    tickets: { legacy: true },
    guilds: {
      server: {
        users: {
          player: { wallet: 50, bank: 20, xp: 255, lastWorkAt: 123 },
          bad: { wallet: -10, xp: 'lots' },
        },
      },
    },
  });
  assert.equal(state.tickets.legacy, true);
  assert.deepEqual(state.guilds.server.users.player, {
    wallet: 50,
    bank: 20,
    xp: 255,
    lastMessageXpAt: 0,
    lastWorkAt: 123,
    lastRobAt: 0,
    lastCrimeAt: 0,
    lastDailyAt: 0,
  });
  assert.equal(state.guilds.server.users.bad.wallet, 0);
  assert.equal(state.guilds.server.users.bad.xp, 0);
  assert.throws(() => normalizeEconomyState({ guilds: [] }), /guilds/);
});

test('leaderboard and rank are server-scoped and ordered by XP', () => {
  const guild = {
    users: {
      a: normalizeProfile({ xp: 255 }),
      b: normalizeProfile({ xp: 100 }),
      c: normalizeProfile({ xp: 255 }),
    },
  };
  assert.deepEqual(leaderboardFor(guild).map(({ userId }) => userId), ['a', 'c', 'b']);
  assert.deepEqual(rankFor(guild, 'c'), { level: 2, current: 0, needed: 220, rank: 2 });
  assert.equal(rankFor(guild, 'missing'), null);
});

test('economy leaderboard sorts by wallet plus bank balance', () => {
  const guild = {
    users: {
      a: normalizeProfile({ wallet: 100, bank: 400 }),
      b: normalizeProfile({ wallet: 700, bank: 0 }),
      c: normalizeProfile({ wallet: 250, bank: 250 }),
    },
  };
  assert.deepEqual(economyLeaderboardFor(guild).map(({ userId, total }) => [userId, total]), [
    ['b', 700],
    ['a', 500],
    ['c', 500],
  ]);
});

test('work cooldown is one hour', () => {
  assert.equal(WORK_COOLDOWN_MS, 60 * 60 * 1000);
});

test('cooldown remaining is clamped at zero', () => {
  assert.equal(getCooldownRemaining(10_000, 10_500, 60_000), 59_500);
  assert.equal(getCooldownRemaining(10_000, 70_000, 60_000), 0);
});
