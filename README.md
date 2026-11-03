# Yapper Fun Bot 🎉

A chat-first Yapper bot with a per-server coin economy and Arcane-style chat leveling.

## Quick start

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env` and set `YAPPER_TOKEN` to your bot token.
3. Invite the bot to your server.
4. Run `npm start`.
5. Use `/help` in a server to see the commands.

On a Bot Host, provide `YAPPER_TOKEN` through the host's environment settings. The bot honors the host-provided
`YAPPER_API_URL` when present; otherwise, it uses the standard Yapper API. Keep `state.json` on persistent storage
so economy and XP progress survive restarts.

## Commands

| Command | What it does |
|---------|--------------|
| `/work` | Earn 80–180 coins; 1-hour cooldown |
| `/crime` | Try a high-risk job for 250–600 coins; 55% success chance and 10-minute cooldown |
| `/rob @player` | Try to steal from another player's wallet; 50% success chance and 5-minute cooldown |
| `/daily` | Claim 500–1,000 coins once every 24 hours |
| `/balance` | Check your wallet and bank |
| `/deposit <amount\|all>` | Move coins from wallet to bank |
| `/withdraw <amount\|all>` | Move coins from bank to wallet |
| `/rank` | See your level, rank, and XP progress |
| `/leaderboard` | See the server's top ten by XP |
| `/economyboard` | See the server's top ten by total wallet and bank coins |
| `/help` | Show the in-chat command guide |

Chat in your server to earn **15–25 XP once per minute**. Level thresholds follow the Arcane-style formula: `5 × level² + 50 × level + 100 XP` for each next level. The bot announces level-ups in chat.

All bot responses, including level-up notices, are sent as embeds. Coins, cooldowns, and XP are saved per server in the ignored `state.json` file, so restarting the bot won't reset progress. Wallet and bank balances are capped to prevent overflow.

## Requirements

- Node.js 18 or newer
- A Yapper bot account and token

Keep `.env` private; it is ignored by git. No npm dependencies are required.

## License

MIT
