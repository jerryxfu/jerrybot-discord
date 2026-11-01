import type {
    BetaManagedAgentsAgentCustomToolUseEvent as CustomToolUse,
    BetaManagedAgentsStreamSessionEvents as SessionEvent,
    EventSendParams,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import {type GuildTextBasedChannel, type Message, ThreadAutoArchiveDuration} from "discord.js";
import {splitMessage} from "../utils/splitMessage.js";
import {api} from "./api.js";
import {
    ADVISOR_MODEL,
    BUDGET_CENTS,
    CHANNEL_NOTE,
    CHAT_GUILDS,
    CONTEXT_LIMIT,
    IDLE_MS,
    MODEL,
    MONTHLY_LIMIT_CENTS,
    TECHNEXUS_MOUNT,
    TECHNEXUS_REPO,
    THREAD_NOTE,
    ULTRATHINK_BUDGET_CENTS,
    ULTRATHINK_CONTEXT_LIMIT,
    ULTRATHINK_EFFORT,
    ULTRATHINK_HINT,
    ULTRATHINK_MODEL,
    USAGE_FROM_PERCENT,
} from "./config.js";
import {formatCents, formatTokens, sleepMessage, turnFooter} from "./footers.js";
import {formatMessage, formatTime, recentMessages, withHistory} from "./history.js";
import {parseKeywords, threadName} from "./keywords.js";
import {truncate} from "../utils/truncate.js";
import {monthSpentCents, sessionBudget, spentCents} from "./spend.js";
import {runTool, type ToolResult} from "./tools.js";

/**
 * Chat with the Managed Agents session behind the bot.
 *
 * An @mention starts a conversation in that channel: a fresh session with its
 * own sandbox. From then on every message in the channel is relayed to it
 * until nobody has said anything for IDLE_MS, the context passes its limit,
 * or the per-conversation budget runs out.
 */

const DISCORD_LIMIT = 2000;
const TYPING_REFRESH_MS = 9_000; // the indicator lasts ~10s per sendTyping()
const ADVISOR_THREAD = "anthropic.advisor"; // reserved name of advisor consultations
const SKIP = "[skip]"; // the agent's way of staying quiet (see SYSTEM_PROMPT)
const REPLY_MARKER = /^\s*\[reply:(\d+)\]\s*/; // "[reply:id] text" answers that message (see SYSTEM_PROMPT)
const MAX_RECONNECTS = 3;
// Typing starts once Claude is clearly answering (writing a reply, using a tool,
// asking the advisor), so a [skip] stays silent. A turn still undecided after
// this long gets typing anyway, so long thinking doesn't look like nothing.
const TYPING_DELAY_MS = 4_000;

interface Conversation {
    channel: GuildTextBasedChannel;
    label: string; // "#general", for logs
    sessionId: string;
    ultrathink: boolean; // started at ULTRATHINK_EFFORT
    model: string; // the model this session runs on
    budgetCents: number;
    contextLimit: number;
    contextTokens: number; // size of the context after the latest model request
    lastReply: Message | null; // last message posted this turn, gets the footer
    advisorCalls: number; // advisor consultations this turn
    replies: number; // messages posted this turn
    cachedTokens: number; // input tokens read from cache this turn
    inputTokens: number; // all input tokens this turn, cached or not
    skipped: boolean; // Claude answered [skip] this turn
    preview: string; // the reply being written, from live previews
    lastMessage: Message<true> | null; // latest message relayed; its author is "the person asking" for tools
    pendingTools: number; // custom tool calls still running
    queued: EventSendParams["events"]; // messages that arrived while tools ran
    stream: AbortController | null;
    seen: Set<string>; // event IDs already handled, for deduping on reconnect
    running: boolean;
    idleTimer: NodeJS.Timeout | null;
    typingTimer: NodeJS.Timeout | null;
    typingDelay: NodeJS.Timeout | null;
    ended: boolean;
}

const conversations = new Map<string, Conversation>();
// Budgets held by conversations that are running or starting, counted against
// the monthly limit on top of what's been spent. A little conservative, since
// their spending so far is in both numbers.
let reservedCents = 0;

/** A start refused on purpose. Its message is shown in the channel. */
class ChatUnavailableError extends Error {
}

// Guards against two mentions racing to start a conversation in one channel.
const starting = new Map<string, Promise<Conversation>>();

/** Entry point from the messageCreate event. */
export async function handleChatMessage(message: Message): Promise<void> {
    // Only listen where chat is allowed; everything else is dropped right here.
    if (message.author.bot || !message.inGuild() || !CHAT_GUILDS.includes(message.guildId)) return;

    const botId = message.client.user.id;
    const mentioned = message.mentions.users.has(botId);
    const keywords = parseKeywords(message.content);
    // "@Claude thread ..." forks into a new thread off this message, with its
    // own conversation, even if the channel already has one going. Threads
    // can't be nested, so inside a thread the keyword does nothing.
    const fork = mentioned && keywords.thread && !message.channel.isThread();
    const active = fork ? undefined : conversations.get(message.channel.id);
    if (!active && !mentioned) return;

    const agentId = process.env.CHAT_AGENT_ID;
    const environmentId = process.env.CHAT_ENVIRONMENT_ID;
    if (!agentId || !environmentId) {
        await message.reply("Chat isn't set up yet. Run `pnpm agent:setup` and fill in .env.");
        return;
    }

    let channel: GuildTextBasedChannel = message.channel;
    if (fork) {
        try {
            channel = await message.startThread({
                name: threadName(keywords.rest, botName(message.channel)),
                autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
            });
        } catch (err) {
            console.error("[chat] couldn't create a thread:", err);
            await message.reply({
                content: "-# I couldn't start a thread here (missing permissions?).",
                allowedMentions: {repliedUser: false},
            });
            return;
        }
    }

    const ultrathink = keywords.ultrathink;
    let conversation = active;
    let startedHere = false;
    if (!conversation) {
        let pending = starting.get(channel.id);
        if (!pending) {
            pending = start(channel, agentId, environmentId, ultrathink);
            starting.set(channel.id, pending);
            startedHere = true;
        }
        try {
            conversation = await pending;
        } catch (err) {
            if (err instanceof ChatUnavailableError) {
                await message.reply({content: `-# ${err.message}`, allowedMentions: {repliedUser: false}});
                return;
            }
            console.error("[chat] failed to start a session:", err);
            await message.reply("I couldn't wake up, try again in a bit.");
            return;
        } finally {
            starting.delete(channel.id);
        }
    }

    // 🔥 / ✅ mark the message that started an ultrathink / regular conversation.
    // Effort is fixed once a session exists, so a later ultrathink (🧠) can
    // only ask the model to think harder within the current level.
    let text = formatMessage(message);
    if (startedHere) {
        await message.react(ultrathink ? "🔥" : "✅").catch(() => {
        });
        text = withHistory(await recentMessages(message), text);
    } else if (ultrathink) {
        await message.react("🧠").catch(() => {
        });
        if (!conversation.ultrathink) text += `\n${ULTRATHINK_HINT}`;
    }

    const events: EventSendParams["events"] = [{type: "user.message", content: [{type: "text", text}]}];
    if (startedHere) {
        // Where it's talking sets how long its replies should be. A system
        // message applies to this turn and every one after it.
        const where = channel.isThread() ? THREAD_NOTE : CHANNEL_NOTE;
        const now = `It's ${formatTime(new Date())} now.`;
        events.push({type: "system.message", content: [{type: "text", text: `${where} ${now}`}]});
    }

    conversation.lastMessage = message;
    resetIdleTimer(conversation);
    // While a custom tool is running the session only accepts its result, so
    // messages wait until every tool call has answered.
    if (conversation.pendingTools > 0) {
        conversation.queued.push(...events);
        return;
    }
    await api().beta.sessions.events.send(conversation.sessionId, {events});
}

async function start(
    channel: GuildTextBasedChannel,
    agentId: string,
    environmentId: string,
    ultrathink: boolean,
): Promise<Conversation> {
    const name = botName(channel);
    const month = await monthSpentCents();
    if (month === null) {
        throw new ChatUnavailableError(`${name} can't check this month's spending right now, try again in a bit.`);
    }
    // Computed and reserved with no await in between, so two channels starting
    // at once can't both claim the same remainder.
    const budgetCents = sessionBudget(ultrathink ? ULTRATHINK_BUDGET_CENTS : BUDGET_CENTS, month, reservedCents);
    if (budgetCents === null) {
        throw new ChatUnavailableError(
            `${name} hit the ${formatCents(MONTHLY_LIMIT_CENTS)} monthly limit and is staying asleep until next month.`,
        );
    }
    reservedCents += budgetCents;

    try {
        return await open(channel, agentId, environmentId, ultrathink, budgetCents);
    } catch (err) {
        reservedCents -= budgetCents;
        conversations.delete(channel.id);
        throw err;
    }
}

async function open(
    channel: GuildTextBasedChannel,
    agentId: string,
    environmentId: string,
    ultrathink: boolean,
    budgetCents: number,
): Promise<Conversation> {
    const contextLimit = ultrathink ? ULTRATHINK_CONTEXT_LIMIT : CONTEXT_LIMIT;
    const label = `#${channel.name}`;
    const githubToken = process.env.GITHUB_TOKEN;
    const session = await api().beta.sessions.create({
        // Overriding replaces the agent's whole model config, for this session
        // only. The advisor stays, so the override must be a model it can advise.
        agent: ultrathink
            ? {type: "agent_with_overrides", id: agentId, model: {id: ULTRATHINK_MODEL, effort: ULTRATHINK_EFFORT}}
            : agentId,
        environment_id: environmentId,
        title: label,
        budget: {type: "limit", max_list_cost: {amount: String(budgetCents), currency: "USD"}},
        // TechNexus is private: mounted with a token that can read its code but
        // not push. Without a token there's simply no copy.
        resources: githubToken
            ? [{
                type: "github_repository",
                url: `https://github.com/${TECHNEXUS_REPO}`,
                mount_path: TECHNEXUS_MOUNT,
                authorization_token: githubToken,
            }]
            : [],
    });
    const conversation: Conversation = {
        channel,
        label,
        sessionId: session.id,
        ultrathink,
        model: ultrathink ? ULTRATHINK_MODEL : MODEL,
        budgetCents,
        contextLimit,
        contextTokens: 0,
        lastReply: null,
        advisorCalls: 0,
        replies: 0,
        cachedTokens: 0,
        inputTokens: 0,
        skipped: false,
        preview: "",
        lastMessage: null,
        pendingTools: 0,
        queued: [],
        stream: null,
        seen: new Set(),
        running: false,
        idleTimer: null,
        typingTimer: null,
        typingDelay: null,
        ended: false,
    };
    conversations.set(channel.id, conversation);
    log(conversation, `started ${ultrathink ? "an ultrathink" : "a"} session (${session.id}, ${formatCents(budgetCents)} budget)`);

    // Stream-first: the stream only delivers events from when it opens, so it
    // has to be open before the first message is sent.
    const stream = await openStream(session.id);
    conversation.stream = stream.controller;
    void consume(conversation, stream);

    return conversation;
}

/** The session's event stream, with live previews of replies as they're written. */
function openStream(sessionId: string) {
    return api().beta.sessions.events.stream(sessionId, {event_deltas: ["agent.message"]});
}

async function consume(conversation: Conversation, stream: AsyncIterable<SessionEvent>): Promise<void> {
    let reconnects = 0;

    while (!conversation.ended) {
        try {
            for await (const event of stream) {
                if (conversation.ended) return;
                reconnects = 0; // only give up on drops in a row
                if ("id" in event) {
                    if (conversation.seen.has(event.id)) continue;
                    conversation.seen.add(event.id);
                }
                await handleEvent(conversation, event);
            }
            if (conversation.ended) return;
        } catch (err) {
            if (conversation.ended) return; // aborted on purpose
            console.error(`[chat] ${conversation.label} stream dropped:`, err);
        }

        // The stream closed under us. It has no replay, so reopen it and then
        // catch up on anything we missed from the event history.
        if (++reconnects > MAX_RECONNECTS) {
            await end(conversation, "lost connection");
            return;
        }
        try {
            const next = await openStream(conversation.sessionId);
            conversation.stream = next.controller;
            conversation.preview = ""; // previews don't replay
            for await (const event of api().beta.sessions.events.list(conversation.sessionId)) {
                if (conversation.seen.has(event.id)) continue;
                conversation.seen.add(event.id);
                await handleEvent(conversation, event as SessionEvent);
            }
            stream = next;
        } catch (err) {
            console.error(`[chat] ${conversation.label} reconnect failed:`, err);
        }
    }
}

async function handleEvent(conversation: Conversation, event: SessionEvent): Promise<void> {
    switch (event.type) {
        case "event_start":
            if (event.event.type === "agent.message") conversation.preview = "";
            return;

        case "event_delta": {
            // Type as soon as the reply is clearly not going to be [skip].
            conversation.preview += event.delta.content.text;
            const sofar = conversation.preview.trimStart();
            if (sofar && !SKIP.startsWith(sofar)) startTyping(conversation);
            return;
        }

        case "agent.message": {
            conversation.preview = "";
            const text = event.content.map((block) => (block.type === "text" ? block.text : "")).join("");
            if (!text.trim()) return;
            if (text.trim() === SKIP) {
                conversation.skipped = true;
                return;
            }
            conversation.replies++;
            const marker = text.match(REPLY_MARKER);
            const replyTo = marker?.[1];
            const chunks = splitMessage(marker ? text.slice(marker[0].length) : text);
            for (const [i, chunk] of chunks.entries()) {
                conversation.lastReply = await conversation.channel.send({
                    content: chunk,
                    // Users can be pinged, but never @everyone, @here or roles: the
                    // agent reads the web, so it could be talked into mass pings.
                    // Replying doesn't ping the author on its own.
                    allowedMentions: {parse: ["users"], repliedUser: false},
                    // Only the first chunk is the reply. A message that's gone (or in
                    // another channel) just sends as a normal message.
                    ...(i === 0 && replyTo ? {reply: {messageReference: replyTo, failIfNotExists: false}} : {}),
                });
            }
            return;
        }

        case "agent.tool_use":
        case "agent.mcp_tool_use":
            startTyping(conversation); // working on an answer
            // Under the "auto" policy the server occasionally can't decide and
            // asks us. Nobody is around to approve, so decline.
            if (event.evaluated_permission === "ask") {
                await api().beta.sessions.events.send(conversation.sessionId, {
                    events: [{
                        type: "user.tool_confirmation",
                        tool_use_id: event.id,
                        result: "deny",
                        deny_message: "Nobody is available to approve this. Try another way or explain the limitation.",
                    }],
                });
            }
            return;

        case "agent.custom_tool_use":
            // Run it alongside the stream: create_issue waits on a button click.
            startTyping(conversation);
            conversation.pendingTools++;
            void runCustomTool(conversation, event);
            return;

        case "span.model_request_end": {
            // Everything the model read plus what it wrote, i.e. what the next
            // request will have to read again. If the advisor's requests show up
            // here too, they can't be told apart (no thread ID), but the advisor
            // reads the same transcript, so the number stays about right.
            const usage = event.model_usage;
            const input = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
            conversation.contextTokens = input + usage.output_tokens;
            // Managed Agents caches on its own; this shows how well it's working.
            conversation.cachedTokens += usage.cache_read_input_tokens;
            conversation.inputTokens += input;
            return;
        }

        case "session.thread_created":
            // Each advisor consultation runs in its own thread. The advice
            // itself is redacted, but the consultation shows up here.
            if (event.agent_name === ADVISOR_THREAD) {
                conversation.advisorCalls++;
                startTyping(conversation);
            }
            return;

        case "session.status_running":
            conversation.running = true;
            conversation.typingDelay ??= setTimeout(() => startTyping(conversation), TYPING_DELAY_MS);
            return;

        case "session.status_idle":
            conversation.running = false;
            stopTyping(conversation);
            if (event.stop_reason.type !== "requires_action") logTurn(conversation);
            switch (event.stop_reason.type) {
                case "requires_action":
                    return; // mid-turn, waiting on our tool confirmation
                case "budget_reached":
                    await end(conversation, "out of budget for this conversation");
                    return;
                case "retries_exhausted":
                    await end(conversation, "something broke on my end");
                    return;
                case "refusal":
                    await conversation.channel.send("-# I can't help with that one.");
                    break;
            }
            if (conversation.contextTokens >= conversation.contextLimit) {
                await end(conversation, "conversation got too long");
                return;
            }
            await postFooter(conversation);
            resetIdleTimer(conversation);
            return;

        case "session.status_terminated":
            await end(conversation, "session ended");
            return;

        case "session.error":
            console.error(`[chat] ${conversation.label} session error:`, event);
            return;
    }
}

/**
 * The start_thread tool: creates a thread off a message and moves this
 * conversation (same session, same context) into it. The channel is then free
 * for a new conversation.
 */
async function moveToThread(conversation: Conversation, input: Record<string, unknown>): Promise<ToolResult> {
    const channel = conversation.channel;
    if (channel.isThread()) return {text: "You're already in a thread.", isError: true};

    const messageId = typeof input.message_id === "string" ? input.message_id.trim() : "";
    const anchor = messageId
        ? await channel.messages.fetch(messageId).catch(() => null)
        : conversation.lastMessage;
    if (!anchor) return {text: "Couldn't find that message in this channel.", isError: true};
    if (anchor.hasThread) return {text: "That message already has a thread; pick another one.", isError: true};

    const name = typeof input.name === "string" && input.name.trim()
        ? truncate(input.name.trim(), 80)
        : threadName(anchor.content, botName(channel));
    const thread = await anchor.startThread({name, autoArchiveDuration: ThreadAutoArchiveDuration.OneHour});

    // Re-key it: messages in the thread now reach this conversation, and the
    // channel's no longer do. Typing and replies follow conversation.channel.
    conversations.delete(channel.id);
    conversation.channel = thread;
    conversation.label = `#${thread.name}`;
    conversations.set(thread.id, conversation);
    log(conversation, `moved here from #${channel.name}`);

    return {text: `Moved. This conversation now continues in the thread "${thread.name}": your replies go there, and messages in #${channel.name} no longer reach you. ${THREAD_NOTE}`};
}

/** The bot's name in this server: its nickname if it has one ("Claude"), else its username. */
function botName(channel: GuildTextBasedChannel): string {
    return channel.guild.members.me?.displayName ?? channel.client.user.displayName;
}

/** Runs a tool call, sends its result back, then releases any queued messages. */
async function runCustomTool(conversation: Conversation, event: CustomToolUse): Promise<void> {
    let result: ToolResult;
    try {
        result = event.name === "start_thread"
            ? await moveToThread(conversation, event.input)
            : await runTool(event.name, event.input, {channel: conversation.channel, lastMessage: conversation.lastMessage});
    } catch (err) {
        result = {text: `The tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true};
    }
    log(conversation, `used ${event.name}${result.isError ? " (failed)" : ""}`);
    if (conversation.ended) return;

    try {
        await api().beta.sessions.events.send(conversation.sessionId, {
            events: [{
                type: "user.custom_tool_result",
                custom_tool_use_id: event.id,
                content: [{type: "text", text: result.text}],
                is_error: result.isError ?? false,
            }],
        });
    } catch (err) {
        console.error(`[chat] ${conversation.label} couldn't send a tool result:`, err);
    }

    conversation.pendingTools--;
    if (conversation.pendingTools === 0 && conversation.queued.length > 0) {
        const events = conversation.queued.splice(0);
        await api().beta.sessions.events.send(conversation.sessionId, {events}).catch((err: unknown) => {
            console.error(`[chat] ${conversation.label} couldn't send queued messages:`, err);
        });
    }
}

function showsUsage(conversation: Conversation): boolean {
    return conversation.contextTokens * 100 > conversation.contextLimit * USAGE_FROM_PERCENT;
}

/**
 * Appends the turn's footer to its last reply (or posts it if it won't fit):
 * whether the advisor was consulted, and usage where it's shown.
 */
async function postFooter(conversation: Conversation): Promise<void> {
    const reply = conversation.lastReply;
    const advisorCalls = conversation.advisorCalls;
    conversation.lastReply = null;
    conversation.advisorCalls = 0;
    if (!reply) return; // a [skip] turn posted nothing

    const usage = showsUsage(conversation)
        ? {
            model: conversation.model,
            contextTokens: conversation.contextTokens,
            contextLimit: conversation.contextLimit,
            spent: await spentCents(conversation.sessionId),
            budget: conversation.budgetCents,
        }
        : null;
    const advisor = advisorCalls > 0 ? {model: conversation.model, advisor: ADVISOR_MODEL, calls: advisorCalls} : null;
    const footer = turnFooter(advisor, usage);
    if (!footer) return;

    const edited = `${reply.content}\n${footer}`;
    if (edited.length <= DISCORD_LIMIT) {
        await reply.edit({content: edited, allowedMentions: {parse: []}}).catch(() => {
        });
    } else {
        await conversation.channel.send(footer).catch(() => {
        });
    }
}

function resetIdleTimer(conversation: Conversation): void {
    if (conversation.idleTimer) clearTimeout(conversation.idleTimer);
    conversation.idleTimer = setTimeout(() => {
        // Don't fall asleep mid-answer or mid-tool; check again once it's done.
        if (conversation.running || conversation.pendingTools > 0) {
            resetIdleTimer(conversation);
            return;
        }
        void end(conversation);
    }, IDLE_MS);
}

function startTyping(conversation: Conversation): void {
    if (conversation.ended || conversation.typingTimer) return;
    const type = () => void conversation.channel.sendTyping().catch(() => {
    });
    type();
    conversation.typingTimer = setInterval(type, TYPING_REFRESH_MS);
}

function stopTyping(conversation: Conversation): void {
    if (conversation.typingTimer) clearInterval(conversation.typingTimer);
    if (conversation.typingDelay) clearTimeout(conversation.typingDelay);
    conversation.typingTimer = null;
    conversation.typingDelay = null;
}

/**
 * One line per event worth knowing about, prefixed "[chat] #channel". Never
 * includes message contents: the Console has the full transcripts.
 */
function log(conversation: Conversation, text: string): void {
    console.log(`[chat] ${conversation.label} ${text}`);
}

/** "[chat] #general replied, asked the advisor 1x, context 45K, 92% cached" or "... skipped". */
function logTurn(conversation: Conversation): void {
    const replies = conversation.replies;
    const what = replies > 0 ? `replied${replies > 1 ? ` (${replies} messages)` : ""}`
        : conversation.skipped ? "skipped" : "ended a turn without replying";
    const advisor = conversation.advisorCalls > 0 ? `, asked the advisor ${conversation.advisorCalls}x` : "";
    const cached = conversation.inputTokens > 0
        ? `, ${Math.round((conversation.cachedTokens / conversation.inputTokens) * 100)}% cached`
        : "";
    log(conversation, `${what}${advisor}, context ${formatTokens(conversation.contextTokens)}${cached}`);
    conversation.replies = 0;
    conversation.skipped = false;
    conversation.cachedTokens = 0;
    conversation.inputTokens = 0;
}

async function end(conversation: Conversation, reason: string | null = null): Promise<void> {
    if (conversation.ended) return;
    conversation.ended = true;

    conversations.delete(conversation.channel.id);
    reservedCents -= conversation.budgetCents;
    if (conversation.idleTimer) clearTimeout(conversation.idleTimer);
    stopTyping(conversation);
    conversation.stream?.abort();

    // The session itself is left in place: it's the transcript in the Console.
    const [spent, month] = await Promise.all([spentCents(conversation.sessionId), monthSpentCents()]);
    log(
        conversation,
        `went to sleep (${reason ?? "idle"}): ${spent === null ? "?" : formatCents(spent)} spent, ` +
        `${month === null ? "?" : formatCents(month)} this month`,
    );

    // The conversation's own line follows the footer's rule; the month always shows.
    const own = spent !== null && showsUsage(conversation)
        ? {spent, budget: conversation.budgetCents}
        : null;
    await conversation.channel.send(sleepMessage(botName(conversation.channel), reason, month, own)).catch(() => {
    });
}
