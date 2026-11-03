import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { Bot, Embed } from './yapper.js';
import {
  addMessageXp,
  credit,
  CRIME_COOLDOWN_MS,
  DAILY_COOLDOWN_MS,
  economyLeaderboardFor,
  getCooldownRemaining,
  leaderboardFor,
  MAX_BALANCE,
  normalizeEconomyState,
  normalizeProfile,
  rankFor,
  ROB_COOLDOWN_MS,
  WORK_COOLDOWN_MS,
} from './economy.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(ROOT, 'state.json');

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error(`Unable to read .env: ${error.message}`, { cause: error });
  }

  for (const [index, rawLine] of contents.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Invalid .env entry on line ${index + 1}.`);
    const [, name] = match;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

function loadState() {
  let contents;
  try {
    contents = fs.readFileSync(STATE_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeEconomyState({ guilds: {} });
    throw new Error(`Unable to read state.json: ${error.message}`, { cause: error });
  }
  try {
    return normalizeEconomyState(JSON.parse(contents));
  } catch (error) {
    throw new Error(`Unable to load state.json: ${error.message}`, { cause: error });
  }
}

function saveState(value) {
  const temporary = `${STATE_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, STATE_PATH);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve the original write error */ }
    throw new Error(`Unable to save state.json: ${error.message}`, { cause: error });
  }
}

loadDotEnv();
const TOKEN = process.env.YAPPER_TOKEN?.trim();
if (!TOKEN) throw new Error('YAPPER_TOKEN is required. Set it in the environment or in .env.');

const UPDATE_CHANNEL_ID = process.env.UPDATE_CHANNEL_ID?.trim() || '2371da9a-c956-48bd-98bc-a2e85cc5371d';
const SUPPORT_SERVER_ID = process.env.SUPPORT_SERVER_ID?.trim() || '7f3ee36e-c0a5-44d5-97ae-a8ea85558828';
const GITHUB_REPO = process.env.GITHUB_REPO?.trim() || 'Brage321/LootifyBotHostingFiles';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN?.trim() || '';
// New: hourly status channel
const HOUR_STATUS_CHANNEL_ID = process.env.HOUR_STATUS_CHANNEL_ID?.trim() || '';
// New: log system
const LOG_CHANNELS = state.logChannels || {}; // serverId -> channelId mapping

const bot = new Bot(TOKEN);
const state = loadState();

// Set the bot's presence/activity on startup.
function getIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '0.0.0.0';
}

function getOperationalPercent() {
  const cpu = process.cpuUsage();
  const totalMs = cpu.user + cpu.system;
  // Rough estimate: convert to approximate percent over 1 second
  // This is process CPU, not system-wide, but gives a reasonable indicator
  const percent = Math.min(100, (totalMs / 10000) * 10);
  return percent.toFixed(1);
}

function isOver50(percent) {
  return parseFloat(percent) > 50;
}

async function sendHourlyStatus() {
  if (!HOUR_STATUS_CHANNEL_ID) return;
  try {
    const cpuPercent = getOperationalPercent();
    const over = parseFloat(cpuPercent) < 50;

    // For "API", "Bot Host", "Website" - show status based on the percentage
    const labels = ['API', 'Bot Host', 'Website'];
    const entries = [];

    for (const label of labels) {
      const statusLine = over ? '- Not Operational' : cpuPercent;
      entries.push(`${label}: ${statusLine}%`);
    }

    const embed = new Embed()
      .title('Hourly Status')
      .description(
        `Operational Percent: ${cpuPercent}%\n` +
        entries.join('\n')
      )
      .color(over ? 'red' : 'green');

    await bot.send(HOUR_STATUS_CHANNEL_ID, '', { embeds: [embed] });
    console.log(`[hourly] Sent status to channel ${HOUR_STATUS_CHANNEL_ID}`);
  } catch (error) {
    console.warn(`[hourly] Failed to send status: ${error.message || error}`);
  }
}

bot.on('ready', async (me) => {
  try {
    await bot.setStatus('online', 'Fun!');
    console.log(`[app] ${me?.username ?? 'bot'} is online with status "Fun!"`);
  } catch (error) {
    console.warn(`[app] could not set status: ${error.message || error}`);
  }
});

bot.on('ready', () => {
  if (!HOUR_STATUS_CHANNEL_ID) return;
  // Send immediately on ready, then every hour
  sendHourlyStatus();
  setInterval(sendHourlyStatus, 60 * 60 * 1000);
});

function replyEmbed(message, title, description, color = 'blue') {
  const embed = new Embed().title(title).description(description).color(color);
  return message.reply('', { embeds: [embed] });
}

function serverCommand(name, description, handler) {
  bot.command(name, description, async (message) => {
    if (!message.server_id) {
      await replyEmbed(message, 'Server only', `\`/${name}\` only works inside a server.`, 'orange');
      return;
    }
    if (!message.author_id) {
      await replyEmbed(message, 'Command unavailable', 'Could not identify your account for this command.', 'orange');
      return;
    }
    await handler(message);
  });
}

function guildState(guildId) {
  if (!state.guilds[guildId]) state.guilds[guildId] = { users: {} };
  return state.guilds[guildId];
}

function profileFor(guildId, userId) {
  const guild = guildState(guildId);
  if (!guild.users[userId]) guild.users[userId] = normalizeProfile();
  return guild.users[userId];
}

function save() {
  saveState(state);
}

async function checkForUpdates() {
  if (!UPDATE_CHANNEL_ID) return;
  try {
    const headers = { 'User-Agent': 'LootifyBot' };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=20`, { headers });
    if (!response.ok) {
      console.warn(`[updates] GitHub API returned ${response.status}`);
      return;
    }
    const commits = await response.json();
    if (!Array.isArray(commits) || commits.length === 0) return;

    if (!state.lastCommitSha) {
      state.lastCommitSha = commits[0].sha;
      if (typeof state.updateCounter !== 'number') state.updateCounter = 0;
      save();
      return;
    }

    const newCommits = [];
    for (const commit of commits) {
      if (commit.sha === state.lastCommitSha) break;
      newCommits.push(commit);
    }
    if (newCommits.length === 0) return;

    newCommits.reverse();
    for (const commit of newCommits) {
      state.updateCounter = (state.updateCounter || 0) + 1;
      const fullMessage = String(commit.commit?.message || 'Update').trim();
      const [titleLine, ...rest] = fullMessage.split('\n');
      const body = rest.join('\n').trim();
      const embed = new Embed()
        .title(`Update (${state.updateCounter})`)
        .description(body ? `${titleLine}\n\n${body}` : titleLine)
        .color('blue');
      try {
        await bot.send(UPDATE_CHANNEL_ID, '', { embeds: [embed] });
      } catch (error) {
        console.warn(`[updates] Could not send update embed: ${error.message || error}`);
      }
    }

    state.lastCommitSha = commits[0].sha;
    save();
  } catch (error) {
    console.warn(`[updates] Failed to check for updates: ${error.message || error}`);
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function money(amount) {
  return `$${Math.max(0, Math.floor(amount)).toLocaleString('en-US')}`;
}

function duration(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds >= 86400) {
    const days = Math.ceil(seconds / 86400);
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (seconds >= 3600) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function parseMention(value) {
  const match = /^<@!?([^>]+)>$/.exec(value || '');
  return match?.[1] || null;
}

function getUserName(user) {
  return user?.display_name || user?.username || 'Player';
}

function getUsage(message) {
  return message.args.trim();
}

function helpText() {
  return [
    '**Yapper Fun Bot**',
    '`/work` — earn coins from a job (1 hour cooldown)',
    '`/crime` — take a risky shot at a big payout (10 minute cooldown)',
    '`/rob @player` — try to steal coins (5 minute cooldown)',
    '`/daily` — claim your daily reward',
    '`/balance` — check your wallet and bank',
    '`/deposit <amount|all>` / `/withdraw <amount|all>` — move coins',
    '`/rank` — see your level and XP progress',
    '`/leaderboard` — see the server XP leaderboard',
    '`/economyboard` — see the server economy leaderboard',
    '`/global-leaderboard` — see global economy leaderboard',
    '`/global-levelboard` — see global level leaderboard',
    '',
    'Chat to earn XP! You get **15–25 XP** once per minute. Level XP follows the Arcane-style curve.',
    'Support Server: https://yapin.gg/invite/6ZBZ2yQRBG'
  ].join('\n');
}

serverCommand('help', 'Show fun bot commands', async (message) => {
  await replyEmbed(message, 'Yapper Fun Bot', helpText());
});

serverCommand('work', 'Work for coins', async (message) => {
  const profile = profileFor(message.server_id, message.author_id);
  const now = Date.now();
  const remaining = getCooldownRemaining(profile.lastWorkAt, now, WORK_COOLDOWN_MS);
  if (remaining) {
    await replyEmbed(message, 'Work cooldown', `You're tired! Try working again in **${duration(remaining)}**.`, 'orange');
    return;
  }

  const earned = randomInt(80, 180);
  const actualEarned = credit(profile, 'wallet', earned);
  profile.lastWorkAt = now;
  save();
  const jobs = [
    'delivered a suspiciously large pizza order',
    'fixed the village Wi-Fi',
    'walked a very dramatic corgi',
    'found a wallet and returned it (mostly)',
    'won an argument with a vending machine',
  ];
  await replyEmbed(message, 'Work complete', `🧰 You ${jobs[randomInt(0, jobs.length - 1)]} and earned **${money(actualEarned)}**!`, 'green');
});

serverCommand('crime', 'Try a high-risk crime for a big payout', async (message) => {
  const profile = profileFor(message.server_id, message.author_id);
  const now = Date.now();
  const remaining = getCooldownRemaining(profile.lastCrimeAt, now, CRIME_COOLDOWN_MS);
  if (remaining) {
    await replyEmbed(message, 'Crime cooldown', `The heat is still on. Try again in **${duration(remaining)}**.`, 'orange');
    return;
  }

  profile.lastCrimeAt = now;
  if (Math.random() < 0.55) {
    const earned = randomInt(250, 600);
    const actualEarned = credit(profile, 'wallet', earned);
    save();
    await replyEmbed(message, 'Crime successful', `🕶️ You pulled off the caper and got away with **${money(actualEarned)}**!`, 'green');
  } else {
    const fine = Math.min(profile.wallet, randomInt(100, 300));
    profile.wallet -= fine;
    save();
    await replyEmbed(message, 'Crime failed', `🚨 Busted! You paid a **${money(fine)}** fine and escaped with your dignity.`, 'red');
  }
});

serverCommand('rob', 'Try to rob another player', async (message) => {
  const targetId = parseMention(getUsage(message));
  if (!targetId) {
    await replyEmbed(message, 'Missing target', 'Tag a player to rob: `/rob @player`.', 'orange');
    return;
  }
  if (targetId === message.author_id) {
    await replyEmbed(message, 'Invalid target', "You can't rob yourself. Try `/work` instead.", 'orange');
    return;
  }

  const guild = guildState(message.server_id);
  const victim = guild.users[targetId];
  if (!victim || victim.wallet < 50) {
    await replyEmbed(message, 'No wallet to rob', "That player doesn't have enough in their wallet to rob.", 'orange');
    return;
  }

  const thief = profileFor(message.server_id, message.author_id);
  const now = Date.now();
  const remaining = getCooldownRemaining(thief.lastRobAt, now, ROB_COOLDOWN_MS);
  if (remaining) {
    await replyEmbed(message, 'Robbery cooldown', `Keep a low profile! You can try robbing again in **${duration(remaining)}**.`, 'orange');
    return;
  }

  thief.lastRobAt = now;
  if (Math.random() < 0.5) {
    const stolen = Math.min(
      victim.wallet,
      MAX_BALANCE - thief.wallet,
      Math.max(1, Math.floor(victim.wallet * randomInt(15, 35) / 100))
    );
    if (stolen === 0) {
      await replyEmbed(message, 'Wallet full', 'Your wallet is full. Deposit some coins before trying to rob someone.', 'orange');
      return;
    }
    victim.wallet -= stolen;
    credit(thief, 'wallet', stolen);
    save();
    await replyEmbed(message, 'Robbery successful', `🥷 You robbed <@${targetId}> and got away with **${money(stolen)}**!`, 'green');
  } else {
    const fine = Math.min(thief.wallet, randomInt(50, 150));
    thief.wallet -= fine;
    save();
    await replyEmbed(message, 'Robbery failed', `🚓 You got caught trying to rob <@${targetId}> and paid a **${money(fine)}** fine!`, 'red');
  }
});

serverCommand('daily', 'Claim your daily coin reward', async (message) => {
  const profile = profileFor(message.server_id, message.author_id);
  const now = Date.now();
  const remaining = getCooldownRemaining(profile.lastDailyAt, now, DAILY_COOLDOWN_MS);
  if (remaining) {
    await replyEmbed(message, 'Daily reward claimed', `You've already claimed your daily reward. Come back in **${duration(remaining)}**.`, 'orange');
    return;
  }

  const reward = randomInt(500, 1000);
  const actualReward = credit(profile, 'wallet', reward);
  profile.lastDailyAt = now;
  save();
  await replyEmbed(message, 'Daily reward', `🎁 Daily reward claimed: **${money(actualReward)}**!`, 'green');
});

serverCommand('balance', 'Check your wallet and bank balance', async (message) => {
  const profile = profileFor(message.server_id, message.author_id);
  await replyEmbed(message, 'Your balance', `💰 <@${message.author_id}>\nWallet: **${money(profile.wallet)}**\nBank: **${money(profile.bank)}**`);
});

async function moveMoney(message, from, to, verb) {
  const profile = profileFor(message.server_id, message.author_id);
  const input = getUsage(message).toLowerCase();
  const available = profile[from];
  const amount = input === 'all'
    ? Math.min(available, MAX_BALANCE - profile[to])
    : Number(input);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    await replyEmbed(message, 'Invalid amount', `Use \`/${verb} <positive amount|all>\`.`, 'orange');
    return;
  }
  if (amount > available) {
    await replyEmbed(message, 'Not enough coins', `You only have **${money(available)}** available to ${verb}.`, 'orange');
    return;
  }
  if (amount > MAX_BALANCE - profile[to]) {
    await replyEmbed(message, 'Account full', `Your ${to} is full. Move some coins out before transferring more.`, 'orange');
    return;
  }
  profile[from] -= amount;
  credit(profile, to, amount);
  save();
  await replyEmbed(message, 'Transfer complete', `🏦 Moved **${money(amount)}** ${verb === 'deposit' ? 'into' : 'out of'} your bank.`, 'green');
}

serverCommand('deposit', 'Deposit coins into your bank', async (message) => {
  await moveMoney(message, 'wallet', 'bank', 'deposit');
});

serverCommand('withdraw', 'Withdraw coins from your bank', async (message) => {
  await moveMoney(message, 'bank', 'wallet', 'withdraw');
});

serverCommand('rank', 'Check your level and XP progress', async (message) => {
  const guild = guildState(message.server_id);
  const profile = profileFor(message.server_id, message.author_id);
  const rank = rankFor(guild, message.author_id);
  const barLength = 12;
  const filled = Math.floor(rank.current / rank.needed * barLength);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(barLength - filled)}`;
  await replyEmbed(message, `${getUserName(message.author)}'s rank`,
    `🏆 Level **${rank.level}** · Server rank **#${rank.rank}**\n` +
    `${bar} ${rank.current}/${rank.needed} XP\n${profile.xp.toLocaleString('en-US')} total XP`);
});

serverCommand('leaderboard', 'Show the server XP leaderboard', async (message) => {
  const guild = guildState(message.server_id);
  const entries = leaderboardFor(guild);
  if (entries.length === 0) {
    await replyEmbed(message, 'XP leaderboard', 'No one is on the leaderboard yet. Chat to start earning XP!');
    return;
  }

  const rows = await Promise.all(entries.map(async (entry, index) => {
    let name = `<@${entry.userId}>`;
    try {
      name = getUserName(await bot.user(entry.userId));
    } catch (error) {
      console.warn(`[leaderboard] Could not load profile for ${entry.userId}: ${error.message}`);
    }
    return `${index + 1}. **${name}** — Level ${entry.level} · ${entry.xp.toLocaleString('en-US')} XP`;
  }));
  await replyEmbed(message, '🏆 XP leaderboard', rows.join('\n'));
});

serverCommand('economyboard', 'Show the server economy leaderboard', async (message) => {
  const guild = guildState(message.server_id);
  const entries = economyLeaderboardFor(guild);
  if (entries.length === 0) {
    await replyEmbed(message, 'Economy leaderboard', 'No one is on the leaderboard yet. Earn or save some coins!');
    return;
  }

  const rows = await Promise.all(entries.map(async (entry, index) => {
    let name = `<@${entry.userId}>`;
    try {
      name = getUserName(await bot.user(entry.userId));
    } catch (error) {
      console.warn(`[economyboard] Could not load profile for ${entry.userId}: ${error.message}`);
    }
    return `${index + 1}. **${name}** — ${money(entry.total)} total (${money(entry.wallet)} wallet · ${money(entry.bank)} bank)`;
  }));
  await replyEmbed(message, '💰 Economy leaderboard', rows.join('\n'));
});

bot.on('message', async (message) => {
  if (!message.server_id || !message.author_id || message.author_bot || message.command) return;
  if (typeof message.content !== 'string' || message.content.trim().length < 2) return;

  const profile = profileFor(message.server_id, message.author_id);
  const result = addMessageXp(profile, Date.now(), randomInt(15, 25));
  if (!result) return;

  save();
  if (result.leveledUp) {
    await replyEmbed(message, 'Level up!', `🎉 <@${message.author_id}> leveled up to **level ${result.level}**!`, 'green');
  }
});

bot.on('error', (error) => {
  console.error('[yapper] runtime error:', error.stack || error.message || error);
});

bot.command('server-usage', 'Show bot host resource usage', async (message) => {
  const mem = process.memoryUsage();
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
  const cpu = process.cpuUsage();
  const uptimeSeconds = process.uptime();
  const cpuPercent = ((cpu.user + cpu.system) / 1e6 / Math.max(1, uptimeSeconds) * 100).toFixed(1);

  let storageText = 'Unavailable';
  try {
    const stats = fs.statfsSync(process.cwd());
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bfree * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    storageText = `${mb(usedBytes)}/${mb(totalBytes)} MB`;
  } catch (error) {
    storageText = `Unavailable (${error.message || error})`;
  }

  const embed = new Embed()
    .title('Server usage')
    .description(
      `RAM: ${mb(mem.rss)} MB | CPU: ${cpuPercent}% | Storage: ${storageText} | Uptime: ${Math.floor(uptimeSeconds)}s`
    )
    .color('blue');
  await message.reply('', { embeds: [embed] });
});

bot.command('status', 'Show bot status (owner only)', async (message) => {
  const OWNER_ID = '14012713-369e-4e39-9fa8-8f319d71c49d';
  if (message.author_id !== OWNER_ID) {
    await replyEmbed(message, 'Unauthorized', 'You are not the bot owner.', 'orange');
    return;
  }
  try {
    const cpuPercent = getOperationalPercent();
    const over = parseFloat(cpuPercent) < 50;

    const embed = new Embed()
      .title('Bot Status')
      .description(
        `Operational Percent: ${cpuPercent}%\n` +
        `API: ${over ? '- Not Operational' : cpuPercent}%\n` +
        `Bot Host: ${over ? '- Not Operational' : cpuPercent}%\n` +
        `Website: ${over ? '- Not Operational' : cpuPercent}%`
      )
      .color(over ? 'red' : 'green');
    await message.reply('', { embeds: [embed] });
  } catch (error) {
    console.error('[status] Error:', error.message || error);
    await replyEmbed(message, 'Error', `Failed to get status: ${error.message || error}`, 'red');
  }
});

bot.command('log-setup', 'Set auto-log channel for this server', async (message) => {
  if (!message.server_id) {
    await replyEmbed(message, 'Server only', 'This command only works inside a server.', 'orange');
    return;
  }
  const OWNER_ID = '14012713-369e-4e39-9fa8-8f319d71c49d';
  if (message.author_id !== OWNER_ID) {
    await replyEmbed(message, 'Unauthorized', 'You are not the bot owner.', 'orange');
    return;
  }
  const channel = message.channel_id;
  LOG_CHANNELS[message.server_id] = channel;
  saveState({ ...state, logChannels: LOG_CHANNELS });
  await replyEmbed(message, 'Log channel set', 'Auto-log channel set to <#' + channel + '> for server ' + message.server_id + '.', 'green');
});

bot.on('ban', async (serverId, userId) => {
  const channelId = LOG_CHANNELS[serverId];
  if (!channelId) return;
  try {
    const embed = new Embed()
      .title('Ban Log')
      .description(`User <@${userId}> was banned from server ${serverId}`)
      .color('red');
    await bot.send(channelId, '', { embeds: [embed] });
  } catch (error) {
    console.warn('[ban-log] Failed to send ban log:', error.message || error);
  }
});

bot.on('kick', async (serverId, userId) => {
  const channelId = LOG_CHANNELS[serverId];
  if (!channelId) return;
  try {
    const embed = new Embed()
      .title('Kick Log')
      .description(`User <@${userId}> was kicked from server ${serverId}`)
      .color('orange');
    await bot.send(channelId, '', { embeds: [embed] });
  } catch (error) {
    console.warn('[kick-log] Failed to send kick log:', error.message || error);
  }
});

function start() {
  process.once('SIGINT', () => {
    console.log('[app] received SIGINT; shutting down');
    bot.stop();
  });
  process.once('SIGTERM', () => {
    console.log('[app] received SIGTERM; shutting down');
    bot.stop();
  });
  bot.start().catch((error) => {
    console.error('[yapper] could not start:', error.stack || error.message);
    process.exitCode = 1;
    bot.stop();
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  start();
}
// Test commit
