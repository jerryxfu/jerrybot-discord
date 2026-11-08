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
in that channel until it goes to sleep: after 5 minutes with no messages, after 15 messages in a
row that weren't for it (none answered, none mentioning it), or on `@Claude sleep`.

- A sleeping conversation keeps its session for 1 hour: the next mention there wakes it up (🔁)
  with everything said before, plus the channel messages since. After that its session is archived
  and the next mention starts fresh. Sleeping and awake sessions are saved in
  `data/chat-sessions.json`, so after a bot restart, conversations that were awake go to sleep (with
  a note in their channel) and can be woken up the same way.
- `@Claude stop` stops what Claude is doing (⏹️); with more text after it, the rest is then relayed.
  `@Claude reset` (or `clear`) ends the channel's conversation for good, awake or asleep, so the next
  mention starts fresh (🧹). `/claude stop` does the same and answers in the channel; use it when
  something's stuck. `/claude help` shows a short guide as an embed, only to whoever runs it
  (`public: True` posts it for everyone; `AS_EMBED` in `src/commands/claude/help.ts` switches to plain text).
  `/claude list` posts every conversation, awake (🟢, with its context and spend) or asleep (💤, with
  until when a mention wakes it), plus this month's spend.
- Images (png, jpeg, gif, webp, up to 5 MB) and PDFs (up to 32 MB) attached to a message are passed
  to Claude so it can see them. Files Claude writes to `/mnt/session/outputs/` in its sandbox are
  attached in the channel after its turn (up to 10 MB each).

- Only works in the servers listed in `CHAT_GUILDS`.
- A new conversation also gets the last few channel messages (up to 10, from the last hour) as context.
- `@Claude thread <question>` starts the conversation in a new thread off that message instead,
  with the channel's recent messages as context, like forking. It works even while the channel
  has its own conversation going. Replies there can be longer; in a channel Claude keeps them short.
  Keywords combine: `@Claude thread escalate ...`.
- Regular conversations (✅) run on Claude Haiku 5.5, which consults a Claude Opus 5.5 advisor for
  anything that needs planning. Escalated conversations run on Claude Sonnet 5.5 at xhigh effort, with
  the same advisor. Start one with `@Claude escalate ...` (🔥), or escalate a running conversation
  the same way: it moves to a new Sonnet session that gets everything said so far (but not the old
  sandbox), and the bot posts `-# ✅ Switched to Sonnet 5.5`. A bare `@Claude escalate` (nothing else in
  the message) isn't passed on: Sonnet picks up the latest request instead. Haiku can also escalate by itself
  (the `escalate` tool) when a task needs it. `ultrathink` works as an alias of `escalate`; in a
  conversation that's already escalated, it only asks Claude to think harder (👍).
- Limits per conversation: 400K context / $3 regular, 500K / $8 escalated (a fresh budget when
  it escalates partway through; the footer and sleep message then show only the escalated session's
  spend). Once a conversation
  passes 50% of its context limit, replies show a usage line with the model, context and cost.
- The bot shows as online while any conversation is awake, and idle while they're all asleep.
- Chat stops starting conversations once this month's chat spend reaches $98.
- Claude has tools the bot runs for it (`src/chat/tools.ts`): `list_channels` and `read_messages`
  (only channels the person asking can see), `react`, and TechNexus issues: `list_issues`,
  `read_issue`, `create_issue` and `comment_on_issue`. Creating and commenting post a preview that waits
  for someone in the channel to click the button; the conversation carries on meanwhile, and Claude is
  told the outcome. With `GITHUB_TOKEN` set, read-only copies of the repos in `MOUNTED_REPOS`
  (`src/chat/config.ts`) are in its sandbox at `/workspace/<name>`; anyone in the server can ask Claude
  to read them, so only list repos you'd show everyone. The Discord and GitHub tokens stay in the bot; none of the tools can delete, kick, ban or
  change anything in the server.
- Claude can also move a conversation into a thread itself (`start_thread`), keeping its context.
- Claude can mention people (users only, never @everyone or roles) and answer as a Discord reply when
  it points back to an earlier message.

Everything Claude is told, plus model, effort and limits, lives in `src/chat/config.ts`:
`SYSTEM_PROMPT` (behavior and tone), `CHANNEL_NOTE` / `THREAD_NOTE` (reply length, sent at the start of
each conversation), `ESCALATED_NOTE` / `HANDOFF_NOTE` (escalated conversations) and `ESCALATE_HINT`. After changing the model,
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
  Waking a sleeping conversation reuses its session; anything else starts a new one.
- When a conversation ends for good (asleep for an hour, out of budget, too long, `/claude stop`),
  its session is **archived**: hidden from the Console's default session list, but still readable
  there (transcript and cost) and counted in the monthly total.

### First-time setup

1. **Claim the Max plan credits.** Link a Claude Console organization to the Max plan, following
   [API credits for Max and Team plans](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)
   (the plan's subscriber has to do it). Check the Console's billing page shows the credits.
2. **Create an API key.** [Claude Console](https://platform.claude.com) → in the linked
   organization → **API Keys** → create one (shown only once) and put it in `.env` as `ANTHROPIC_API_KEY`.
3. **Enable Message Content.** Discord Developer Portal → the app → **Bot** → **Privileged Gateway
   Intents** → turn on **Message Content Intent**. The bot won't log in without it.
4. **(Optional) GitHub token.** github.com → Settings → Developer settings → Fine-grained tokens:
   the repos in `MOUNTED_REPOS` (`src/chat/config.ts`), **Contents: Read-only**, and **Issues: Read and
   write** (used for TechNexus only). Put it in
   `.env` as `GITHUB_TOKEN`. Read-only contents is what stops Claude from pushing.
5. **Create the agent and environment.** Run `pnpm agent:setup` and paste the two lines it prints
   (`CHAT_ENVIRONMENT_ID=...`, `CHAT_AGENT_ID=...`) into `.env`.
6. **Register commands.** `pnpm deploy_l` (this server) or `pnpm deploy_g` (everywhere).
7. **Test locally.** `pm2 stop jerrybot-discord` so the server copy doesn't answer too, then `pnpm dev`:
   - `@Claude hey` → ✅, typing, a reply. A follow-up without the mention should still get answered.
   - `@Claude escalate ...` in another channel → 🔥, and Sonnet 5.5 answering (check the Console).
   - `@Claude escalate ...` in a running Haiku conversation → 🔥, `-# ✅ Switched to Sonnet 5.5`, and
     an answer that knows what was said before.
   - Wait 5 minutes → `-# Claude is going to sleep 😴... · mention me within 1h to pick this back up ||$0.04/$98.00||`.
     Mention it again → 🔁, and it remembers what was said.
   - Attach a screenshot and ask about it; ask for a file ("write that as a .py file") → an attachment.
   - `/claude stop` → it ends, and the next mention starts fresh (✅).
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
pnpm deploy_l   # register to the dev guild
pnpm deploy_g   # register globally
pnpm deploy_cl  # remove all commands from the dev guild
pnpm deploy_cg  # remove all global commands
```

## Project structure

```
src/
├── index.ts            # entry
├── client.ts           # typed Client subclass
├── chat/               # @mention chat (Managed Agents)
│   ├── config.ts        # prompts, models, limits: the file to edit
│   ├── conversation.ts  # sessions: start, relay messages, events, sleep, wake up, escalate
│   ├── footers.ts       # the "-#" lines under replies and sleep messages
│   ├── history.ts       # recent channel messages for a new conversation
│   ├── keywords.ts      # "escalate" (alias "ultrathink") / "thread" / "stop" / "sleep" parsing
│   ├── spend.ts         # costs: per session, this month, budgets
│   ├── store.ts         # data/chat-sessions.json: sessions awake and asleep
│   ├── tools.ts         # the tools the bot runs for Claude (Discord, GitHub issues)
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

**SSH in from the Mac:** the VM is `jerrybot-discord` in the **jerrydev** project (zone `us-east1-c`).
gcloud's default project is TechNexus, so always pass `--project`. The bot, pm2 and the repo belong to
the user `jerryfu_mc`, so log in as that user (without `jerryfu_mc@`, gcloud logs in as `jerry`,
where none of it exists; `sudo su - jerryfu_mc` switches over):

```bash
gcloud compute ssh jerryfu_mc@jerrybot-discord --project jerrydev --zone us-east1-c
```

From Ghostty, the VM also needs Ghostty's terminal definition, or `nano`, `clear` etc. complain about
`xterm-ghostty`. Done once already (2026-11-01); run it again from the Mac if the VM is ever rebuilt:

```bash
infocmp -x xterm-ghostty | gcloud compute ssh jerryfu_mc@jerrybot-discord --project jerrydev --zone us-east1-c -- tic -x -
```

It prints "Pseudo-terminal will not be allocated" and "older tic versions may treat the description
field as an alias". Both are harmless.

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
pnpm deploy_l                  # only if a command's definition changed (the server's commands; deploy_g would add duplicates)
pnpm agent:setup               # only if the chat model, prompt or tools changed (once, here or on the Mac)
pm2 restart jerrybot-discord
```
