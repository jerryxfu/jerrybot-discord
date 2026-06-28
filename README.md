# JerryBot

A Discord bot built on [discord.js](https://discord.js.org) v14 and TypeScript.

- **discord.js v14**
- **TypeScript 6** strict config
- **pnpm** package manager
- Native Node `--env-file` for secrets

## Setup

`.env` needs (create the file in the root):

```
DISCORD_TOKEN=   # Developer Portal → Bot → Reset Token
CLIENT_ID=       # Developer Portal → General Information → Application ID
GUILD_ID=        # a dev server ID, for instant command registration
```

## Running

```bash
pnpm dev       # start with auto-reload (development)
pnpm start     # start once (production)
```

## Deploying slash commands

Commands must be registered with Discord before they appear. Run this whenever a command's **definition** changes, not for logic-only edits.

```bash
pnpm deploy              # register to the dev guild
pnpm deploy global       # register globally
pnpm deploy clear_local  # remove all commands from the dev guild
pnpm deploy clear_global # remove all global commands
```

## Project structure

```
src/
├── index.ts            # entry
├── client.ts           # typed Client subclass
├── core/
│   ├── loadCommands.ts  # explicit command registry
│   ├── loadEvents.ts    # explicit event registry
│   └── deploy.ts        # slash-command registration script
├── commands/            # one file per command
├── events/              # one file per gateway event
├── types/               # Command / Event contracts
└── utils/               # guards, helpers
```

## Hosting (GCP Compute Engine, note to self)

[GCP Compute Engine](https://docs.cloud.google.com/free/docs/free-cloud-features#compute)

**One-time setup (SSH into the VM):**

```bash
# Install git, Node (latest LTS), and pnpm
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
corepack prepare pnpm@latest --activate

# Verify
node -v && pnpm -v && git --version

git clone https://github.com/jerryxfu/jerrybot-discord && cd jerrybot-discord
pnpm install
nano .env                      # paste DISCORD_TOKEN

# run under PM2 so it survives crashes + reboots
pnpm add -g pm2
pm2 start ecosystem.config.cjs # config defines name + stop_exit_codes
pm2 save
pm2 startup                    # run the command it prints, for relaunch-on-reboot
```

**Updating after a code change:**

```bash
git pull
pnpm install                   # only if deps changed
pnpm deploy                    # only if a command's definition changed
pm2 restart jerrybot-discord
```
