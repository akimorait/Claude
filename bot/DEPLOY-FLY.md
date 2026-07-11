# Deploy the bot to Fly.io

Runs the bot as an always-on background worker (no web server, no public port).
Your RPC URL and executor private key live as **Fly secrets** — they are never
committed and never baked into the Docker image.

## One-time setup

```bash
cd bot

# 1. Create the app (name must be globally unique), then put that name in fly.toml:
fly apps create your-unique-app-name
#    edit fly.toml -> app = "your-unique-app-name"

# 2. Store the sensitive values as secrets (use your wss:// Alchemy URL for speed):
fly secrets set \
  RPC_URL="wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY" \
  PRIVATE_KEY="your_executor_private_key"

# 3. Deploy. Starts in DRY_RUN mode — it logs opportunities, sends nothing.
fly deploy

# 4. Watch it think:
fly logs
```

## Going live

When the logs look right, set `DRY_RUN = "false"` in `fly.toml`, then redeploy:

```bash
fly deploy
```

Make sure the executor address holds ~0.05–0.1 ETH for gas first. Flash mode
needs no trading capital; profits accrue as WETH inside the contract and are
withdrawable only by the owner key.

## Everyday commands

| Command | What it does |
|---|---|
| `fly logs` | stream the bot's output |
| `fly status` | machine health |
| `fly machine restart` | restart the worker |
| `fly deploy` | apply changes after editing `fly.toml` |
| `fly secrets set RPC_URL="..."` | rotate the RPC URL / key (triggers a restart) |

## Custom watchlist

The default watchlist is `tokens.example.json`. To use your own: add
`bot/tokens.json`, set `TOKENS_FILE = "tokens.json"` in `fly.toml`, and redeploy.
(`tokens.json` is gitignored, so keep a copy — Fly builds from your local files.)

## Notes

- `fly deploy` builds the image on Fly's remote builder, so you don't need Docker
  installed locally.
- The machine restarts automatically on crash; the bot also self-heals a stalled
  RPC connection via its 90-second watchdog.
- 512 MB is generous for this workload — you can drop it to 256 MB to save a bit.
