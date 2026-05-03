# Aetheria Genesis

A **100-agent autonomous civilization** in Minecraft — powered by cloud LLMs, cloud memory, and a real-time browser dashboard.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AETHERIA GENESIS                       │
├──────────────┬──────────────┬───────────────┬───────────────┤
│  100 Souls   │  Mineflayer  │  Groq/OpenR.  │  Upstash      │
│  (Profiles)  │  (MC Bots)   │  (LLM Brain)  │  (Redis Mem)  │
├──────────────┴──────┬───────┴───────────────┴───────────────┤
│                     │                                        │
│   Cognitive Loop    │   Social Systems                       │
│   Observe → Recall  │   Gossip · Culture · Religion          │
│   → Think → Act     │   Beliefs · Doctrines · Pantheon       │
├─────────────────────┴────────────────────────────────────────┤
│                  Divine Dashboard (Express + Socket.IO)       │
│   Live Map · Inner Monologue · God Console · Religion Track  │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start (Replit)

1. **Fork/Import** this repo into Replit
2. **Set Secrets** in the Replit Secrets tab:
   - `MC_HOST` — Your Minecraft server IP
   - `MC_PORT` — Server port (default 25565)
   - `LLM_API_KEY` — Your Groq or OpenRouter API key
   - `LLM_PROVIDER` — `groq` or `openrouter`
   - `UPSTASH_REDIS_URL` — Your Upstash Redis URL (optional, falls back to in-memory)
   - `UPSTASH_REDIS_TOKEN` — Your Upstash Redis token (optional)
3. Click **Run** — the dashboard opens automatically

## Features

### Agent Biology
- **100 unique souls** with distinct personalities (ambition, superstition, greed, loyalty, curiosity, aggression, empathy, creativity)
- **Cognitive loop**: Observe → Recall → Think (LLM) → Act
- **Emergent culture**: Gossip spreads information bot-to-bot, beliefs form from divine events

### Divine Dashboard
- **Live Map**: Real-time positions of all 100 agents on a 2D canvas
- **Inner Monologue Feed**: Read every agent's private thoughts
- **God Console**: Strike lightning, spawn items, whisper divine messages, broadcast world events
- **Religion Tracker**: Watch doctrines emerge as agents witness and interpret "God Events"

### Cloud-Native
- **LLM**: Groq API (llama-3.3-70b) or OpenRouter — no local GPU needed
- **Memory**: Upstash Redis for persistent agent memories, falls back to in-memory
- **Bots**: Mineflayer connects to any remote Minecraft server

## Configuration

All settings are in `src/config.js` and can be overridden via environment variables. See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `MC_HOST` | `localhost` | Minecraft server IP |
| `MC_PORT` | `25565` | Minecraft server port |
| `AGENT_COUNT` | `100` | Number of agents to spawn |
| `SPAWN_DELAY_MS` | `2000` | Delay between agent spawns |
| `TICK_INTERVAL_MS` | `10000` | Cognitive loop interval per agent |
| `LLM_PROVIDER` | `groq` | LLM provider (`groq` or `openrouter`) |
| `LLM_API_KEY` | — | API key for the LLM provider |
| `LLM_MODEL` | `llama-3.3-70b-versatile` | Model to use |
| `GOSSIP_CHANCE` | `0.3` | Probability of gossip per tick |

## Project Structure

```
src/
├── index.js              # Entry point — orchestrates everything
├── config.js             # Central configuration
├── agents/
│   ├── generateSouls.js  # Creates 100 unique personality profiles
│   └── cognition.js      # Cognitive loop (Observe/Recall/Think/Act)
├── bot/
│   └── manager.js        # Mineflayer bot lifecycle manager
├── llm/
│   └── client.js         # Groq/OpenRouter API client
├── memory/
│   └── store.js          # Upstash Redis memory (with in-memory fallback)
├── social/
│   ├── gossip.js         # Information spread system
│   └── religion.js       # Emergent belief/doctrine system
└── dashboard/
    ├── server.js          # Express + Socket.IO server
    └── public/
        └── index.html     # Divine Dashboard frontend
```

---

## The Vibe Squad (Roblox)

A **3-bot autonomous friend group** for Roblox — designed to be indistinguishable from casual human players.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      THE VIBE SQUAD                         │
├──────────────┬──────────────┬───────────────┬───────────────┤
│  3 Personas  │  Playwright  │  Groq LLM     │  God Console  │
│  (Profiles)  │  (Browser)   │  (Chat Brain) │  (Commands)   │
├──────────────┴──────┬───────┴───────────────┴───────────────┤
│                     │                                        │
│   Chat Engine       │   Movement System                      │
│   Typing Delay ·    │   Tether · Free Roam · Idle Fidget    │
│   Deflection · LLM  │   Human Errors · Stealth              │
├─────────────────────┴────────────────────────────────────────┤
│              Vibe Squad Dashboard (Express + Socket.IO)       │
│   Squad Status · Chat Log · Event Feed · Command Buttons     │
└─────────────────────────────────────────────────────────────┘
```

### The Squad

| Bot | Username | Personality | Speech Style |
|-----|----------|-------------|--------------|
| Zachy | `zachy_vibs` | The Chill One — low energy, high humor | lowercase, minimal punctuation, "fr", "ngl", "bruh" |
| Luna | `luna_sky7` | The Social One — high energy, very friendly | mixed case, moderate punctuation, "omg", "slay", "bestie" |
| Jason | `not_jason` | The Quiet One — low energy, observant | lowercase, rare punctuation, "lol", "gg", "nah" |

### Quick Start

```bash
# Set environment variables
export LLM_API_KEY=your-groq-api-key
export ROBLOX_GAME_URL=https://www.roblox.com/games/YOUR_GAME_ID
export ROBLOX_COOKIE_1=your-roblosecurity-cookie-bot1
export ROBLOX_COOKIE_2=your-roblosecurity-cookie-bot2
export ROBLOX_COOKIE_3=your-roblosecurity-cookie-bot3

# Launch the squad
npm run vibe-squad
```

### God Console Commands

Type these in Roblox chat as `T0rzyz`:

| Command | Effect |
|---------|--------|
| `=free` | Bots stop following, enter Social Mode (wander + talk to strangers) |
| `=squad` | Bots regroup on your position and follow you |
| `=vibe [emote]` | All bots perform the specified emote with you |
| `=chatty` | Toggle increased chattiness |
| `=status` | Report current squad status |

### Anti-Detection Features

- **Typing simulation**: 40-60 WPM with variable keystroke delays and jitter
- **Human errors**: Occasionally walk into walls, pause to "check menu", jump randomly
- **Bot deflection**: Humorous responses when accused of being a bot
- **No spam**: Cooldown timers, duplicate detection, consecutive message limits
- **Browser stealth**: Randomized viewports, user agents, timezones; webdriver flag hidden
- **Kick recovery**: Exponential backoff rejoin with randomized delays

### Roblox Project Structure

```
src/roblox/
├── index.js              # Vibe Squad entry point
├── config.js             # Roblox-specific configuration
├── personas/
│   └── squad.js          # 3 bot personas with speech styles
├── brain/
│   └── chat.js           # Groq-powered chat with persona prompting
├── browser/
│   └── automation.js     # Playwright browser automation for Roblox
├── behavior/
│   ├── movement.js       # Tethering, wandering, idle animations
│   ├── social.js         # Chat engagement, spam prevention, deflection
│   └── stealth.js        # Human errors, kick handling, anti-detection
├── commands/
│   └── godConsole.js     # =free, =squad, =vibe, =chatty commands
├── utils/
│   └── timing.js         # Typing delays, random helpers
└── dashboard/
    ├── server.js          # Express + Socket.IO dashboard
    └── public/
        └── index.html     # Vibe Squad monitoring UI
```

## License

MIT
