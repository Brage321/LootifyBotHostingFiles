export const XP_COOLDOWN_MS = 60_000;
export const WORK_COOLDOWN_MS = 60 * 60_000;
export const ROB_COOLDOWN_MS = 5 * 60_000;
export const CRIME_COOLDOWN_MS = 10 * 60_000;
export const DAILY_COOLDOWN_MS = 24 * 60 * 60_000;

export const MAX_BALANCE = 1_000_000_000_000;
const MAX_XP = 1_000_000_000_000;

export function xpRequiredForLevel(level) {
  if (!Number.isSafeInteger(level) || level < 0) throw new Error('Level must be a non-negative integer.');
  return 5 * (level - 1) * level * (2 * level - 1) / 6 +
    50 * (level - 1) * level / 2 +
    100 * level;
}

function finiteNonNegative(value, fallback = 0, max = MAX_BALANCE) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function normalizeEconomyState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('state.json must contain a JSON object.');
  }
  const guilds = value.guilds === undefined ? {} : value.guilds;
  if (!guilds || typeof guilds !== 'object' || Array.isArray(guilds)) {
    throw new Error('state.json field "guilds" must be an object.');
  }
  for (const [guildId, guild] of Object.entries(guilds)) {
    if (!guild || typeof guild !== 'object' || Array.isArray(guild) ||
        !guild.users || typeof guild.users !== 'object' || Array.isArray(guild.users)) {
      throw new Error(`state.json entry for server "${guildId}" must contain a users object.`);
    }
    for (const [userId, profile] of Object.entries(guild.users)) {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        throw new Error(`state.json profile for user "${userId}" must be an object.`);
      }
      guild.users[userId] = normalizeProfile(profile);
    }
  }
  return { ...value, guilds };
}

export function normalizeProfile(profile = {}) {
  return {
    wallet: finiteNonNegative(profile.wallet),
    bank: finiteNonNegative(profile.bank),
    xp: finiteNonNegative(profile.xp, 0, MAX_XP),
    lastMessageXpAt: timestamp(profile.lastMessageXpAt),
    lastWorkAt: timestamp(profile.lastWorkAt),
    lastRobAt: timestamp(profile.lastRobAt),
    lastCrimeAt: timestamp(profile.lastCrimeAt),
    lastDailyAt: timestamp(profile.lastDailyAt),
  };
}

export function credit(profile, account, amount) {
  if (!['wallet', 'bank'].includes(account) || !Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Credit requires a wallet or bank and a non-negative whole number.');
  }
  const credited = Math.min(amount, MAX_BALANCE - profile[account]);
  profile[account] += credited;
  return credited;
}

export function levelForXp(xp) {
  const totalXp = finiteNonNegative(xp, 0, MAX_XP);
  let low = 0;
  let high = 1;
  while (xpRequiredForLevel(high) <= totalXp) {
    low = high;
    high *= 2;
  }
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (xpRequiredForLevel(middle) <= totalXp) low = middle;
    else high = middle;
  }
  return low;
}

export function xpProgress(xp) {
  const totalXp = finiteNonNegative(xp, 0, MAX_XP);
  const level = levelForXp(totalXp);
  return {
    level,
    current: totalXp - xpRequiredForLevel(level),
    needed: xpRequiredForLevel(level + 1) - xpRequiredForLevel(level),
  };
}

export function addMessageXp(profile, now, amount) {
  if (now - profile.lastMessageXpAt < XP_COOLDOWN_MS) return null;
  const before = levelForXp(profile.xp);
  profile.xp = Math.min(MAX_XP, profile.xp + amount);
  profile.lastMessageXpAt = now;
  const progress = xpProgress(profile.xp);
  return { amount, ...progress, leveledUp: progress.level > before };
}

export function leaderboardFor(guild, limit = 10) {
  return Object.entries(guild.users)
    .map(([userId, profile]) => ({ userId, xp: profile.xp, level: levelForXp(profile.xp) }))
    .sort((a, b) => b.xp - a.xp || a.userId.localeCompare(b.userId))
    .slice(0, limit);
}

export function economyLeaderboardFor(guild, limit = 10) {
  return Object.entries(guild.users)
    .map(([userId, profile]) => ({
      userId,
      wallet: profile.wallet,
      bank: profile.bank,
      total: profile.wallet + profile.bank,
    }))
    .sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId))
    .slice(0, limit);
}

export function rankFor(guild, userId) {
  const profile = guild.users[userId];
  if (!profile) return null;
  const rank = leaderboardFor(guild, Object.keys(guild.users).length)
    .findIndex((entry) => entry.userId === userId);
  return { ...xpProgress(profile.xp), rank: rank + 1 };
}

export function getCooldownRemaining(lastActionAt, now, cooldown) {
  return Math.max(0, cooldown - (now - lastActionAt));
}
