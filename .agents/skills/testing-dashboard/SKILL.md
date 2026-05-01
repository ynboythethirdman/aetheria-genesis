# Testing the Aetheria Genesis Dashboard

## Prerequisites

- Node.js 18+ installed
- `npm install` completed in repo root
- No external services required for basic dashboard testing

## Devin Secrets Needed

- `LLM_API_KEY` (Groq or OpenRouter) — only needed for cognitive tick / lore generation testing
- `MC_HOST` — Minecraft server IP, only needed for live agent testing
- `UPSTASH_REDIS_URL` — optional, falls back to in-memory store

## Starting the App (Dashboard-Only Mode)

```bash
cd /home/ubuntu/repos/aetheria-genesis
node src/index.js
```

- Dashboard serves on port 3000 (configurable via `DASHBOARD_PORT`)
- Without `MC_HOST`, the app logs a warning and skips bot spawning but the dashboard runs fully
- 100 souls are loaded from `souls.json`, wallets initialized (~1700 total emeralds), guilds assigned
- A GDP snapshot is taken at startup, so economic data is available immediately

## Port Conflicts

If port 3000 is already in use (EADDRINUSE error), kill the existing process:
```bash
fuser -k 3000/tcp
```
Note: `lsof` may not be available on the VM — use `fuser` instead.

## What's Testable Without Minecraft

| Feature | Testable? | Notes |
|---------|-----------|-------|
| GDP ticker (Overview tab) | Yes | Shows real wealth/Gini from initialized wallets |
| Guild distribution | Yes | 6 guilds with correct agent counts summing to 100 |
| Economy tab (market prices) | Yes | Base prices display; inflation updates after inject-emeralds |
| God Console (roster) | Partial | All 100 agents listed in dropdown and roster; guild/wealth show "Loading..." without active bots |
| Soul Window | Yes | Click any agent in roster to see personality traits, backstory |
| Inject Emeralds | Yes | Works via UI button or API; updates total wealth and Gini via Socket.IO |
| Prayer popup | Yes | Simulate via browser console: `showPrayerAlert({id: 999, agentName: 'Test', prayer: 'text', timestamp: Date.now()})` |
| Justice tab | Yes | Renders empty bounties/inmates/trial log |
| Lore Keeper | Partial | Tab renders with "Generate Chapter Now" button; actual generation needs LLM_API_KEY |
| Neural Streams | No | Requires active cognitive ticks (needs MC_HOST + LLM_API_KEY) |
| Reputation Web | No | Requires active agent relationships |
| Live Heatmap | No | Requires agent position data from Minecraft |

## Testing the Inflation Fix

The hyperinflation bug (exponential price compounding) was fixed to use linear scaling from base prices. To verify:

1. Note initial market prices on Economy tab (food=1, wood=2, stone=4, etc.)
2. Inject emeralds via API: `curl -X POST localhost:3000/api/god/inject-emeralds -H 'Content-Type: application/json' -d '{"agentId":0,"amount":500}'`
3. Check updated prices via API: `curl localhost:3000/api/economy | python3 -m json.tool`
4. Verify prices scale linearly: `price = basePrices[item] * (1 + totalInjected/1000 * 0.1)`
5. Emerald price should always stay at 1 (currency standard)

## Key API Endpoints

- `GET /api/economy` — totalWealth, gini, gdpHistory, marketPrices, trades, disputes
- `GET /api/guilds` — guild definitions, guildCounts, inventedRoles, strikeActive
- `GET /api/justice` — activeBounties, inmates, recentTrials
- `GET /api/prayers` — totalPrayers, unanswered, recentPrayers
- `GET /api/souls` — all 100 soul profiles
- `GET /api/agents/:id` — individual agent state (requires parseInt for numeric ID)
- `POST /api/god/lightning` — smite (body: {agentId})
- `POST /api/god/whisper` — divine whisper (body: {agentId, message})
- `POST /api/god/spawn-item` — spawn item (body: {agentId, item})
- `POST /api/god/broadcast` — broadcast event (body: {event})
- `POST /api/god/inject-emeralds` — inject emeralds (body: {agentId, amount})

## Known UI Behaviors (Not Bugs)

- Economy tab market prices display as rounded integers (1e, 2e) even when actual values are decimals (1.05, 2.1) — intentional formatting
- Agent roster shows "Loading..." for guild and "0e" for wealth without MC_HOST — expected, bot agents aren't connected
- Economy tab stats (Total Wealth, Gini, etc.) update via Socket.IO `economy:snapshot` event, which fires after inject-emeralds actions
- Top bar GDP/Gini ticker updates in real-time via the same Socket.IO event

## Browser Console Testing

The prayer popup can be triggered directly via browser console since no agents generate prayers without MC_HOST:
```js
showPrayerAlert({id: 999, agentName: 'Test Agent', prayer: 'O Divine One, grant me wisdom', timestamp: Date.now()})
```
This tests the full prayer UI flow including the Answer/Ignore buttons and divine response input.
