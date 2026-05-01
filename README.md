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

## License

MIT
