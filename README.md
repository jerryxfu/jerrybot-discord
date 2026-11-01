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

# Optional, for chat (see below)
ANTHROPIC_API_KEY=    # Claude Console → API Keys
CHAT_ENVIRONMENT_ID=  # printed by `pnpm agent:setup`
CHAT_AGENT_ID=        # printed by `pnpm agent:setup`
GITHUB_TOKEN=         # optional: TechNexus code + issues, see below
```

## Chat

@mention the bot to start a conversation. It runs on a Claude
[Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) session, so it
has a sandbox (it can clone public repos) and web search. After the mention it answers everyone
in that channel until 5 minutes pass with no messages, then posts that it's going to sleep.

- Only works in the servers listed in `CHAT_GUILDS`.
- A new conversation also gets the last few channel messages (up to 10, from the last 30 minutes) as context.
- `@Claude thread <question>` starts the conversation in a new thread off that message instead,
  with the channel's recent messages as context, like forking. It works even while the channel
  has its own conversation going. Replies there can be longer; in a channel Claude keeps them short.
  Keywords combine: `@Claude thread ultrathink ...`.
- Regular conversations (✅) run on Claude Haiku 5.5, which consults a Claude Opus 5.5 advisor for
  anything that needs planning. Start with `@Claude ultrathink ...` (🔥) for Claude Sonnet 5.5 at
  xhigh effort, with the same advisor.
- Limits per conversation: 180K context / $1.50 regular, 250K / $3.50 ultrathink. Once a conversation
  passes 50% of its context limit, replies show a usage line with the model, context and cost.
- Chat stops starting conversations once this month's chat spend reaches $98.
- Claude has tools the bot runs for it (`src/chat/tools.ts`): `list_channels` and `read_messages`
  (only channels the person asking can see), `react`, and TechNexus issues: `list_issues`,
  `read_issue`, `create_issue` and `comment_on_issue`. Creating and commenting wait for someone in the
  channel to click the button. With `GITHUB_TOKEN` set, a read-only copy of TechNexus is in its
  sandbox. The Discord and GitHub tokens stay in the bot; none of the tools can delete, kick, ban or
  change anything in the server.
- Claude can also move a conversation into a thread itself (`start_thread`), keeping its context.
- Claude can mention people (users only, never @everyone or roles) and answer as a Discord reply when
  it points back to an earlier message.

Everything Claude is told, plus model, effort and limits, lives in `src/chat/config.ts`:
`SYSTEM_PROMPT` (behavior and tone), `CHANNEL_NOTE` / `THREAD_NOTE` (reply length, sent at the start of
each conversation) and `ULTRATHINK_HINT`. After changing the model,
effort, prompt or tools, run `pnpm agent:setup` again to push a new agent version. Everything else
(limits, history, servers) applies on the next conversation without it.

Every conversation is a session you can read in the Console under **Managed Agents → Sessions**,
with the full transcript and its cost.

### How sessions work

- The **environment** (`CHAT_ENVIRONMENT_ID`) is a template: cloud sandbox, unrestricted networking.
  It's made once and reused.
- The **agent** (`CHAT_AGENT_ID`) is the model, prompt and tools. It's versioned: `pnpm agent:setup`
  updates it, and running conversations keep the version they started on.
- Each **conversation** is a new session with its own sandbox container, built from the environment.
  Several channels can have conversations at the same time; they don't share files or history.
  Old sessions are never reused, so every conversation starts clean.

### First-time setup

1. **Claim the Max plan credits.** Link a Claude Console organization to the Max plan, following
   [API credits for Max and Team plans](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)
   (the plan's subscriber has to do it). Check the Console's billing page shows the credits.
2. **Create an API key.** [Claude Console](https://platform.claude.com) → in the linked
   organization → **API Keys** → create one (shown only once) and put it in `.env` as `ANTHROPIC_API_KEY`.
3. **Enable Message Content.** Discord Developer Portal → the app → **Bot** → **Privileged Gateway
   Intents** → turn on **Message Content Intent**. The bot won't log in without it.
4. **(Optional) GitHub token.** github.com → Settings → Developer settings → Fine-grained tokens:
   only the `jerryxfu/TechNexus` repo, **Contents: Read-only** and **Issues: Read and write**. Put it in
   `.env` as `GITHUB_TOKEN`. Read-only contents is what stops Claude from pushing.
5. **Create the agent and environment.** Run `pnpm agent:setup` and paste the two lines it prints
   (`CHAT_ENVIRONMENT_ID=...`, `CHAT_AGENT_ID=...`) into `.env`.
6. **Register commands.** `pnpm deploy`.
7. **Test locally.** `pm2 stop jerrybot-discord` so the server copy doesn't answer too, then `pnpm dev`:
   - `@Claude hey` → ✅, typing, a reply. A follow-up without the mention should still get answered.
   - `@Claude ultrathink ...` in another channel → 🔥, and Sonnet 5.5 answering (check the Console).
   - Wait 5 minutes → `-# Claude is going to sleep 😴... ||$0.04/$98.00||`.
   - If it says "I couldn't wake up", the error is in the `pnpm dev` output.
8. **Deploy to the VM.** After pulling, add the same variables (including `GITHUB_TOKEN` if you use it) to the VM's `.env`
   (don't run `agent:setup` again, it's the same agent), then `pnpm install` and `pm2 restart jerrybot-discord`.

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
├── chat/               # @mention chat (Managed Agents)
│   ├── config.ts        # prompts, models, limits: the file to edit
│   ├── conversation.ts  # sessions: start, relay messages, events, sleep
│   ├── footers.ts       # the "-#" lines under replies and sleep messages
│   ├── history.ts       # recent channel messages for a new conversation
│   ├── keywords.ts      # "ultrathink" / "thread" parsing
│   ├── spend.ts         # costs: per session, this month, budgets
│   └── api.ts           # the Anthropic client
├── core/
│   ├── loadCommands.ts  # explicit command registry
│   ├── loadEvents.ts    # explicit event registry
│   ├── deploy.ts        # slash-command registration script
│   └── setupAgent.ts    # creates/updates the chat agent
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
