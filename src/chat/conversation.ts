import type {
    BetaManagedAgentsAgentCustomToolUseEvent as CustomToolUse,
    BetaManagedAgentsStreamSessionEvents as SessionEvent,
    BetaManagedAgentsUserMessageEventParams,
    EventSendParams,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type {BetaFileMetadata} from "@anthropic-ai/sdk/resources/beta/files";
import {type Client, type GuildTextBasedChannel, type Message, ThreadAutoArchiveDuration} from "discord.js";
import {basename} from "node:path";
import {sleep} from "../utils/sleep.js";
import {splitMessage} from "../utils/splitMessage.js";
import {truncate} from "../utils/truncate.js";
import {api} from "./api.js";
import {
    ADVISOR_MODEL,
    BUDGET_CENTS,
    CHANNEL_NOTE,
    CHAT_GUILDS,
    CONTEXT_LIMIT,
    ESCALATE_BUDGET_CENTS,
    ESCALATE_CONTEXT_LIMIT,
    ESCALATE_EFFORT,
    ESCALATE_HINT,
    ESCALATE_MODEL,
    ESCALATED_NOTE,
    HANDOFF_NOTE,
    IDLE_MS,
    MAX_IMAGE_BYTES,
    MAX_PDF_BYTES,
    MAX_UPLOAD_BYTES,
    MIN_SESSION_CENTS,
    MODEL,
    MONTHLY_LIMIT_CENTS,
    RESUME_WINDOW_MS,
    TECHNEXUS_MOUNT,
    TECHNEXUS_REPO,
    THREAD_NOTE,
    UNANSWERED_BEFORE_SLEEP,
    USAGE_FROM_PERCENT,
} from "./config.js";
import {formatCents, formatTokens, modelName, sleepMessage, turnFooter} from "./footers.js";
import {formatMessage, formatTime, recentMessages, withHistory} from "./history.js";
import {parseKeywords, threadName} from "./keywords.js";
import {monthSpentCents, sessionBudget, spentCents} from "./spend.js";
import {deleteStored, getStored, putStored, type StoredSession, storedSessions} from "./store.js";
import {runTool, type ToolResult} from "./tools.js";

/**
 * Chat with the Managed Agents session behind the bot.
 *
 * An @mention starts a conversation in that channel: a fresh session with its
 * own sandbox. From then on every message in the channel is relayed to it
 * until it goes to sleep: nobody said anything for IDLE_MS, it let
 * UNANSWERED_BEFORE_SLEEP messages in a row go by, or someone told it to. A
 * sleeping conversation keeps its session for RESUME_WINDOW_MS, and a mention
 * wakes it up with everything said before. It ends for good when its context
 * passes the limit, its budget runs out, or someone uses /claude stop.
 * Escalating swaps in a new session on a stronger model, given everything
 * said so far.
 */

const DISCORD_LIMIT = 2000;
const DISCORD_FILES = 10; // attachments per message
const TYPING_REFRESH_MS = 9_000; // the indicator lasts ~10s per sendTyping()
const ADVISOR_THREAD = "anthropic.advisor"; // reserved name of advisor consultations
const SKIP = "[skip]"; // the agent's way of staying quiet (see SYSTEM_PROMPT)
const REPLY_MARKER = /^\s*\[reply:(\d+)\]\s*/; // "[reply:id] text" answers that message (see SYSTEM_PROMPT)
const MAX_RECONNECTS = 3;
// Typing starts once Claude is clearly answering (writing a reply, using a tool,
// asking the advisor), so a [skip] stays silent. A turn still undecided after
// this long gets typing anyway, so long thinking doesn't look like nothing.
const TYPING_DELAY_MS = 4_000;
// Output files show up in the Files API a moment after the turn that wrote them.
const OUTPUTS_DELAY_MS = 2_500;
const SWEEP_MS = 15 * 60_000; // how often sessions asleep too long get archived
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
// Threads the bot starts leave the channel list after a day without messages
// (Discord only allows 1 hour, 1 day, 3 days or 1 week). Posting in one brings it back.
const THREAD_ARCHIVE = ThreadAutoArchiveDuration.OneDay;

type Content = BetaManagedAgentsUserMessageEventParams["content"];

interface Conversation {
    channel: GuildTextBasedChannel;
    label: string; // "#general", for logs
    sessionId: string;
    escalated: boolean; // on ESCALATE_MODEL
    switching: boolean; // escalating, opening the new session
    model: string; // the model this session runs on
    budgetCents: number;
    contextLimit: number;
    contextTokens: number; // size of the context after the latest model request
    lastReply: Message | null; // last message posted this turn, gets the footer
    advisorThreads: Set<string>; // advisor consultations this turn, by thread ID
    replies: number; // messages posted this turn
    cachedTokens: number; // input tokens read from cache this turn
    inputTokens: number; // all input tokens this turn, cached or not
    skipped: boolean; // Claude answered [skip] this turn
    usedTools: boolean; // used its sandbox this turn, so it may have written output files
    preview: string; // the reply being written, from live previews
    lastMessage: Message<true> | null; // latest message relayed; its author is "the person asking" for tools
    unanswered: number; // messages relayed since its last reply; a mention resets it
    pendingTools: number; // custom tool calls still running
    waiting: number; // tool outcomes still to come (confirmation buttons)
    queued: EventSendParams["events"]; // messages that arrived while tools ran or it escalated
    outputsSince: number; // epoch ms; output files from before were already posted
    postedFiles: Set<string>; // output files already posted, by file ID
    stream: AbortController | null;
    seen: Set<string>; // event IDs already handled, for deduping on reconnect
    running: boolean;
    idleTimer: NodeJS.Timeout | null;
    typingTimer: NodeJS.Timeout | null;
    typingDelay: NodeJS.Timeout | null;
    ended: boolean;
}

/** A conversation as start() or resume() hand it over, with when it fell asleep if it was woken up. */
interface Opened {
    conversation: Conversation;
    sleptAt: number | null;
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
const starting = new Map<string, Promise<Opened>>();

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

    // "@Claude reset" ends the channel's conversation for good, awake or
    // asleep, so the next mention starts fresh (like /claude stop). "@Claude
    // stop" stops the turn in progress, "@Claude sleep" puts the conversation
    // to sleep, and both only act on one that's awake. Alone in a message,
    // that's all they do. "stop" followed by more text stops the turn, then
    // relays the message.
    if (mentioned && !fork && !keywords.rest && keywords.reset) {
        await stopChat(message.channel.id, "reset, the next mention starts fresh");
        await react(message, "🧹");
        return;
    }
    if (mentioned && !fork && !keywords.rest && (keywords.stop || keywords.sleep)) {
        if (active && keywords.sleep) await end(active, "told to sleep", true);
        else if (active) await interrupt(active, message);
        return;
    }
    if (mentioned && active && keywords.stop) await interrupt(active, message);

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
                autoArchiveDuration: THREAD_ARCHIVE,
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

    const escalate = keywords.escalate;
    let conversation = active;
    let opened: Opened | null = null; // set when this message started or woke up the conversation
    if (!conversation) {
        let pending = starting.get(channel.id);
        const mine = !pending;
        if (!pending) {
            // A sleeping conversation here wakes up. A new thread never has one.
            const asleep = getStored(channel.id);
            pending = asleep
                ? resume(channel, asleep, agentId, environmentId, escalate)
                : start(channel, agentId, environmentId, escalate).then((c) => ({conversation: c, sleptAt: null}));
            starting.set(channel.id, pending);
        }
        try {
            const result = await pending;
            conversation = result.conversation;
            if (mine) opened = result;
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

    // ✅ / 🔥 mark the message that started a regular / escalated conversation,
    // 🔁 one that woke a sleeping conversation up. "escalate" later on moves a
    // regular conversation to an escalated session (🔥 again). An escalated
    // one can only be asked to think harder (👍), since effort is fixed once a
    // session exists.
    const fresh = opened !== null && opened.sleptAt === null;
    const sleptAt = opened?.sleptAt ?? null;
    const switchNow = escalate && !fresh && !conversation.escalated && !conversation.switching;
    // A bare "@Claude escalate" (nothing else in it) only asks for the stronger
    // model, so it isn't relayed: there's nothing to answer. After switching,
    // the new session picks up the latest request instead.
    const bare = escalate && !fresh && sleptAt === null && !keywords.rest && message.attachments.size === 0;
    let text = formatMessage(message);
    if (fresh) {
        await react(message, escalate ? "🔥" : "✅");
        text = withHistory(await recentMessages(message), text);
    } else if (sleptAt !== null) {
        await react(message, "🔁");
        text = withHistory(await recentMessages(message, sleptAt), text, "(Messages since you went to sleep, oldest first:)");
    }
    if (switchNow) {
        await react(message, "🔥");
    } else if (escalate && !fresh) {
        await react(message, "👍");
        text += `\n${ESCALATE_HINT}`;
    }

    const events: EventSendParams["events"] = [{type: "user.message", content: [{type: "text", text}, ...attachmentsOf(message)]}];
    if (fresh) {
        events.push({type: "system.message", content: [{type: "text", text: startNote(channel, escalate)}]});
    } else if (sleptAt !== null) {
        const note = `It's ${formatTime(new Date())} now. You went to sleep at ${formatTime(new Date(sleptAt))}, and this message woke you up: same conversation, picked up where it left off.`;
        events.push({type: "system.message", content: [{type: "text", text: note}]});
    }

    conversation.lastMessage = message;
    conversation.unanswered = mentioned ? 0 : conversation.unanswered + 1;
    resetIdleTimer(conversation);
    if (switchNow) {
        // Goes to the escalated session after the handoff, or to this one if escalating fails.
        if (!bare) conversation.queued.push(...events);
        const askedBy = bare ? message.member?.displayName ?? message.author.displayName : null;
        await escalateConversation(conversation, null, null, askedBy);
        await flushQueued(conversation);
        return;
    }
    if (bare) return; // already escalated, which the 👍 says
    await relay(conversation, events);
}

/**
 * /claude stop and "@Claude reset": ends this channel's conversation for good
 * right away, awake or asleep, stopping whatever it's doing, so the next
 * mention starts fresh. /claude stop also works when something's stuck.
 * Returns false if there was nothing to stop.
 */
export async function stopChat(channelId: string, reason: string): Promise<boolean> {
    starting.delete(channelId); // a start that hangs shouldn't block the next mention
    const conversation = conversations.get(channelId);
    if (conversation) {
        conversations.delete(channelId); // even if ending it goes wrong
        await api().beta.sessions.events.send(conversation.sessionId, {events: [{type: "user.interrupt"}]}).catch(() => {
        });
        await end(conversation, reason);
        return true;
    }
    const stored = getStored(channelId);
    if (!stored) return false;
    deleteStored(channelId);
    await archive(`<#${channelId}>`, stored.sessionId);
    return true;
}

/** A conversation as /claude list shows it. */
export interface ChatSummary {
    channelId: string;
    sessionId: string;
    model: string;
    contextTokens: number;
    contextLimit: number;
    budgetCents: number;
    sleptAt: number | null; // null while awake
}

/** Every conversation that's awake, or asleep and still able to wake up. */
export function listChats(): ChatSummary[] {
    const awake: ChatSummary[] = [...conversations.entries()].map(([channelId, c]) => ({
        channelId,
        sessionId: c.sessionId,
        model: c.model,
        contextTokens: c.contextTokens,
        contextLimit: c.contextLimit,
        budgetCents: c.budgetCents,
        sleptAt: null,
    }));
    const asleep: ChatSummary[] = storedSessions()
        .filter(([channelId, stored]) => stored.sleptAt !== null && !conversations.has(channelId)
            && Date.now() - stored.sleptAt < RESUME_WINDOW_MS)
        .map(([channelId, stored]) => ({
            channelId,
            sessionId: stored.sessionId,
            model: stored.escalated ? ESCALATE_MODEL : MODEL,
            contextTokens: stored.contextTokens,
            contextLimit: stored.escalated ? ESCALATE_CONTEXT_LIMIT : CONTEXT_LIMIT,
            budgetCents: stored.budgetCents,
            sleptAt: stored.sleptAt,
        }));
    return [...awake, ...asleep];
}

/**
 * On startup: the bot shows as idle, and conversations that were awake when
 * it stopped are put to sleep, with a note in their channel, so a mention
 * picks them back up. Then sessions asleep for longer than RESUME_WINDOW_MS
 * are archived, now and every SWEEP_MS.
 */
export async function recoverChatSessions(client: Client<true>): Promise<void> {
    syncPresence(client); // nothing is awake yet
    for (const [channelId, stored] of storedSessions()) {
        if (stored.sleptAt !== null) continue;
        putStored(channelId, {...stored, sleptAt: Date.now()});
        // It may have been mid-turn, with nobody left to post what it says.
        await api().beta.sessions.events.send(stored.sessionId, {events: [{type: "user.interrupt"}]}).catch(() => {
        });
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel?.isTextBased() && !channel.isDMBased()) {
            await channel.send(sleepMessage(botName(channel), "the bot restarted", null, null, RESUME_WINDOW_MS)).catch(() => {
            });
        }
        console.log(`[chat] <#${channelId}> was awake at shutdown, now asleep`);
    }
    await archiveExpired();
    setInterval(() => void archiveExpired(), SWEEP_MS);
}

async function archiveExpired(): Promise<void> {
    for (const [channelId, stored] of storedSessions()) {
        if (stored.sleptAt === null || Date.now() - stored.sleptAt < RESUME_WINDOW_MS) continue;
        if (starting.has(channelId) || conversations.has(channelId)) continue; // being woken up
        deleteStored(channelId);
        await archive(`<#${channelId}>`, stored.sessionId);
    }
}

async function react(message: Message, emoji: string): Promise<void> {
    await message.react(emoji).catch(() => {
    });
}

/**
 * Images and PDFs attached to a message, as content Claude can see. Discord's
 * attachment URLs work as they are. Anything bigger or of another type is
 * only the link in the text (see formatMessage).
 */
function attachmentsOf(message: Message): Content {
    const blocks: Content = [];
    for (const attachment of message.attachments.values()) {
        const type = attachment.contentType?.split(";")[0]?.trim();
        if (type && IMAGE_TYPES.includes(type) && attachment.size <= MAX_IMAGE_BYTES) {
            blocks.push({type: "image", source: {type: "url", url: attachment.url}});
        } else if (type === "application/pdf" && attachment.size <= MAX_PDF_BYTES) {
            blocks.push({type: "document", source: {type: "url", url: attachment.url}, title: attachment.name});
        }
    }
    return blocks;
}

/** "@Claude stop": ends the turn in progress. The conversation stays awake. */
async function interrupt(conversation: Conversation, message: Message<true>): Promise<void> {
    await api().beta.sessions.events.send(conversation.sessionId, {events: [{type: "user.interrupt"}]}).catch((err: unknown) => {
        console.error(`[chat] ${conversation.label} couldn't interrupt:`, err);
    });
    stopTyping(conversation);
    await react(message, "⏹️");
    conversation.lastMessage = message;
    resetIdleTimer(conversation);
    log(conversation, "interrupted");
}

/**
 * Sends events to the session. While a custom tool is running the session
 * only accepts its result, so they wait until every tool call has answered,
 * or until an escalated session is ready.
 */
async function relay(conversation: Conversation, events: EventSendParams["events"]): Promise<void> {
    if (conversation.ended) return;
    if (conversation.pendingTools > 0 || conversation.switching) {
        conversation.queued.push(...events);
        return;
    }
    await api().beta.sessions.events.send(conversation.sessionId, {events});
}

/** Sends what relay() held back, once nothing is in the way. */
async function flushQueued(conversation: Conversation): Promise<void> {
    if (conversation.ended || conversation.pendingTools > 0 || conversation.switching) return;
    if (conversation.queued.length === 0) return;
    const events = conversation.queued.splice(0);
    await api().beta.sessions.events.send(conversation.sessionId, {events}).catch((err: unknown) => {
        console.error(`[chat] ${conversation.label} couldn't send queued messages:`, err);
    });
}

/**
 * The system message at the start of a session. Where it's talking sets how
 * long its replies should be. A system message applies to this turn and every
 * one after it.
 */
function startNote(channel: GuildTextBasedChannel, escalated: boolean): string {
    const where = channel.isThread() ? THREAD_NOTE : CHANNEL_NOTE;
    const here = `This is <#${channel.id}> (#${channel.name}).`;
    const now = `It's ${formatTime(new Date())} now.`;
    return [where, here, now, ...(escalated ? [ESCALATED_NOTE] : [])].join(" ");
}

/** This month's chat spend, or a refusal to start if it can't be read. */
async function monthOrRefuse(channel: GuildTextBasedChannel): Promise<number> {
    const month = await monthSpentCents();
    if (month === null) {
        throw new ChatUnavailableError(`${botName(channel)} can't check this month's spending right now, try again in a bit.`);
    }
    return month;
}

function monthlyLimitReached(channel: GuildTextBasedChannel): ChatUnavailableError {
    return new ChatUnavailableError(
        `${botName(channel)} hit the ${formatCents(MONTHLY_LIMIT_CENTS)} monthly limit and is staying asleep until next month.`,
    );
}

async function start(
    channel: GuildTextBasedChannel,
    agentId: string,
    environmentId: string,
    escalated: boolean,
): Promise<Conversation> {
    const month = await monthOrRefuse(channel);
    // Computed and reserved with no await in between, so two channels starting
    // at once can't both claim the same remainder.
    const budgetCents = sessionBudget(escalated ? ESCALATE_BUDGET_CENTS : BUDGET_CENTS, month, reservedCents);
    if (budgetCents === null) throw monthlyLimitReached(channel);
    reservedCents += budgetCents;

    try {
        return await open(channel, agentId, environmentId, escalated, budgetCents);
    } catch (err) {
        reservedCents -= budgetCents;
        conversations.delete(channel.id);
        syncPresence(channel.client);
        throw err;
    }
}

/**
 * Wakes a sleeping conversation up: the same session, so everything said
 * before is still there. One that can't go on (asleep too long, gone, or
 * nearly out of budget) is archived, and a fresh conversation starts instead.
 */
async function resume(
    channel: GuildTextBasedChannel,
    stored: StoredSession,
    agentId: string,
    environmentId: string,
    escalate: boolean,
): Promise<Opened> {
    const session = await api().beta.sessions.retrieve(stored.sessionId).catch(() => null);
    const spent = Number(session?.usage.list_cost?.amount ?? 0);
    const sleptAt = stored.sleptAt ?? Date.now();
    const usable = session !== null && !session.archived_at && session.status !== "terminated"
        && Date.now() - sleptAt < RESUME_WINDOW_MS
        && stored.budgetCents - spent >= MIN_SESSION_CENTS;
    if (!usable) {
        deleteStored(channel.id);
        if (session && !session.archived_at) void archive(`#${channel.name}`, stored.sessionId);
        return {conversation: await start(channel, agentId, environmentId, escalate), sleptAt: null};
    }

    // As in start(), but the session already has its budget.
    const month = await monthOrRefuse(channel);
    if (sessionBudget(stored.budgetCents, month, reservedCents) === null) throw monthlyLimitReached(channel);
    reservedCents += stored.budgetCents;

    try {
        const conversation = await attach(channel, stored);
        log(conversation, `woke up (${stored.sessionId}, asleep since ${formatTime(new Date(sleptAt))})`);
        return {conversation, sleptAt};
    } catch (err) {
        reservedCents -= stored.budgetCents;
        conversations.delete(channel.id);
        syncPresence(channel.client);
        throw err;
    }
}

async function open(
    channel: GuildTextBasedChannel,
    agentId: string,
    environmentId: string,
    escalated: boolean,
    budgetCents: number,
): Promise<Conversation> {
    const session = await createSession(`#${channel.name}`, agentId, environmentId, escalated, budgetCents);
    const conversation = await attach(channel, {sessionId: session.id, escalated, budgetCents, contextTokens: 0, sleptAt: null});
    log(conversation, `started ${escalated ? "an escalated" : "a"} session (${session.id}, ${formatCents(budgetCents)} budget)`);
    return conversation;
}

/** Sets a conversation up on a session, new or woken up, and starts listening to it. */
async function attach(channel: GuildTextBasedChannel, stored: StoredSession): Promise<Conversation> {
    const conversation: Conversation = {
        channel,
        label: `#${channel.name}`,
        sessionId: stored.sessionId,
        escalated: stored.escalated,
        switching: false,
        model: stored.escalated ? ESCALATE_MODEL : MODEL,
        budgetCents: stored.budgetCents,
        contextLimit: stored.escalated ? ESCALATE_CONTEXT_LIMIT : CONTEXT_LIMIT,
        contextTokens: stored.contextTokens,
        lastReply: null,
        advisorThreads: new Set(),
        replies: 0,
        cachedTokens: 0,
        inputTokens: 0,
        skipped: false,
        usedTools: false,
        preview: "",
        lastMessage: null,
        unanswered: 0,
        pendingTools: 0,
        waiting: 0,
        queued: [],
        outputsSince: Date.now() - 60_000, // some slack for clock differences
        postedFiles: new Set(),
        stream: null,
        seen: new Set(),
        running: false,
        idleTimer: null,
        typingTimer: null,
        typingDelay: null,
        ended: false,
    };
    conversations.set(channel.id, conversation);
    syncPresence(channel.client);
    remember(conversation);

    // Stream-first: the stream only delivers events from when it opens, so it
    // has to be open before the first message is sent.
    const stream = await openStream(stored.sessionId);
    conversation.stream = stream.controller;
    void consume(conversation, stream, stored.sessionId);

    return conversation;
}

/** Saves the conversation's session in the store: awake, or asleep since `sleptAt`. */
function remember(conversation: Conversation, sleptAt: number | null = null): void {
    putStored(conversation.channel.id, {
        sessionId: conversation.sessionId,
        escalated: conversation.escalated,
        budgetCents: conversation.budgetCents,
        contextTokens: conversation.contextTokens,
        sleptAt,
    });
}

function createSession(label: string, agentId: string, environmentId: string, escalated: boolean, budgetCents: number) {
    const githubToken = process.env.GITHUB_TOKEN;
    return api().beta.sessions.create({
        // Overriding replaces the agent's whole model config, for this session
        // only. The advisor stays, so the override must be a model it can advise.
        agent: escalated
            ? {type: "agent_with_overrides", id: agentId, model: {id: ESCALATE_MODEL, effort: ESCALATE_EFFORT}}
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
}

/**
 * Moves a regular conversation to a new escalated session, in place: same
 * channel and Conversation, with everything said so far as the new session's
 * first message. The old session is stopped and archived. Messages that
 * arrive meanwhile are queued for the caller to flush. `reason` and `notes`
 * come from the escalate tool; `askedBy` is who asked with a bare "@Claude
 * escalate". Returns false, leaving the conversation on its current session,
 * if it can't.
 */
async function escalateConversation(
    conversation: Conversation,
    reason: string | null,
    notes: string | null,
    askedBy: string | null = null,
): Promise<boolean> {
    const agentId = process.env.CHAT_AGENT_ID;
    const environmentId = process.env.CHAT_ENVIRONMENT_ID;
    if (!agentId || !environmentId) return false;

    conversation.switching = true;
    startTyping(conversation);
    const fail = async (why: string): Promise<false> => {
        conversation.switching = false;
        stopTyping(conversation);
        await conversation.channel.send(`-# Couldn't escalate (${why}), staying on ${modelName(conversation.model)}.`).catch(() => {
        });
        return false;
    };

    const month = await monthSpentCents();
    if (month === null) return fail("can't check this month's spending");
    // As in start(): computed and reserved with no await in between. The old
    // session's budget is handed back, since it's about to stop.
    const old = {sessionId: conversation.sessionId, budgetCents: conversation.budgetCents, stream: conversation.stream};
    const budgetCents = sessionBudget(ESCALATE_BUDGET_CENTS, month, reservedCents - old.budgetCents);
    if (budgetCents === null) return fail(`too close to the ${formatCents(MONTHLY_LIMIT_CENTS)} monthly limit`);
    reservedCents += budgetCents - old.budgetCents;

    let transcript, session, stream;
    try {
        transcript = await transcriptOf(old.sessionId);
        session = await createSession(conversation.label, agentId, environmentId, true, budgetCents);
        stream = await openStream(session.id);
    } catch (err) {
        console.error(`[chat] ${conversation.label} couldn't open an escalated session:`, err);
        reservedCents -= budgetCents - old.budgetCents;
        return fail("something broke on my end");
    }
    if (conversation.ended) {
        // Stopped or put to sleep meanwhile (end() handled the old session):
        // the new one is no longer wanted.
        reservedCents -= budgetCents - old.budgetCents;
        stream.controller.abort();
        void archive(conversation.label, session.id);
        return false;
    }

    // Swap sessions. Anything the old one was doing, including tool calls
    // still running, is dropped: consume() and runCustomTool() check the
    // session ID.
    Object.assign(conversation, {
        sessionId: session.id,
        escalated: true,
        model: ESCALATE_MODEL,
        budgetCents,
        contextLimit: ESCALATE_CONTEXT_LIMIT,
        contextTokens: 0,
        lastReply: null,
        replies: 0,
        cachedTokens: 0,
        inputTokens: 0,
        skipped: false,
        usedTools: false,
        preview: "",
        unanswered: 0,
        pendingTools: 0,
        outputsSince: Date.now() - 60_000,
        stream: stream.controller,
        seen: new Set(),
        running: false,
    } satisfies Partial<Conversation>);
    conversation.advisorThreads.clear();
    remember(conversation);
    old.stream?.abort();
    void consume(conversation, stream, session.id);
    void retire(conversation.label, old.sessionId);
    log(conversation, `escalated to session ${session.id} (${formatCents(budgetCents)} budget)${reason ? `: ${reason}` : ""}`);

    // The reason is Claude's own words, so it can't ping anyone.
    await conversation.channel.send({
        content: `-# ✅ Switched to ${modelName(ESCALATE_MODEL)}${reason ? `: ${reason}` : ""}`,
        allowedMentions: {parse: []},
    }).catch(() => {
    });

    const earlier = [
        "(Everything said in this conversation so far, oldest first:)",
        transcript.join("\n"),
        ...(reason ? [`(The small model escalated because: ${reason})`] : []),
        ...(notes ? [`(Its notes for you: ${notes})`] : []),
        ...(askedBy ? [`(${askedBy} asked for the stronger model without saying anything else: pick up the latest request in the conversation and answer it properly.)`] : []),
    ].join("\n\n");
    await api().beta.sessions.events.send(session.id, {
        events: [
            {type: "user.message", content: [{type: "text", text: earlier}]},
            {type: "system.message", content: [{type: "text", text: `${startNote(conversation.channel, true)} ${HANDOFF_NOTE}`}]},
        ],
    }).catch(async (err: unknown) => {
        console.error(`[chat] ${conversation.label} couldn't hand off to the escalated session:`, err);
        await end(conversation, "something broke on my end");
    });
    conversation.switching = false;
    await flushQueued(conversation);
    return true;
}

/**
 * What was said in a session, oldest first: messages as they were relayed
 * (images and PDFs only as their links), and its own replies as "You: ...".
 * Queued messages aren't in it yet; they follow the handoff.
 */
async function transcriptOf(sessionId: string): Promise<string[]> {
    const lines: string[] = [];
    for await (const event of api().beta.sessions.events.list(sessionId)) {
        if (event.type !== "user.message" && event.type !== "agent.message") continue;
        const text = event.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim();
        if (!text || text === SKIP) continue;
        lines.push(event.type === "user.message" ? text : `You: ${text.replace(REPLY_MARKER, "")}`);
    }
    return lines;
}

/** Stops a session that's been replaced, mid-turn or not, and archives it. */
async function retire(label: string, sessionId: string): Promise<void> {
    await api().beta.sessions.events.send(sessionId, {events: [{type: "user.interrupt"}]}).catch(() => {
    });
    await archive(label, sessionId);
}

/**
 * Archives a session that's done for good: it disappears from the Console's
 * default session list but stays readable there (transcript, cost) and still
 * counts toward the monthly total.
 */
async function archive(label: string, sessionId: string): Promise<void> {
    await api().beta.sessions.archive(sessionId).catch((err: unknown) => {
        console.error(`[chat] ${label} couldn't archive session ${sessionId}:`, err);
    });
}

/** The session's event stream, with live previews of replies as they're written. */
function openStream(sessionId: string) {
    return api().beta.sessions.events.stream(sessionId, {event_deltas: ["agent.message"]});
}

async function consume(conversation: Conversation, stream: AsyncIterable<SessionEvent>, sessionId: string): Promise<void> {
    let reconnects = 0;
    // Stops once the conversation ends or escalates to another session.
    const current = () => !conversation.ended && conversation.sessionId === sessionId;

    while (current()) {
        try {
            for await (const event of stream) {
                if (!current()) return;
                reconnects = 0; // only give up on drops in a row
                if ("id" in event) {
                    if (conversation.seen.has(event.id)) continue;
                    conversation.seen.add(event.id);
                }
                await handleEvent(conversation, event);
            }
            if (!current()) return;
        } catch (err) {
            if (!current()) return; // aborted on purpose
            console.error(`[chat] ${conversation.label} stream dropped:`, err);
        }

        // The stream closed under us. It has no replay, so reopen it and then
        // catch up on anything we missed from the event history.
        if (++reconnects > MAX_RECONNECTS) {
            await end(conversation, "lost connection", true);
            return;
        }
        try {
            const next = await openStream(sessionId);
            if (!current()) {
                next.controller.abort();
                return;
            }
            conversation.stream = next.controller;
            conversation.preview = ""; // previews don't replay
            for await (const event of api().beta.sessions.events.list(sessionId)) {
                if (!current()) return;
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
            conversation.unanswered = 0;
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
            conversation.usedTools = true;
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
            // Run it alongside the stream, so a slow tool doesn't hold up events.
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

        // Each advisor consultation runs in its own thread: created, then its
        // (redacted) advice is delivered. Either event counts, once per thread,
        // so a consultation shows even if only one of them reaches this stream.
        case "session.thread_created":
            if (event.agent_name === ADVISOR_THREAD) {
                conversation.advisorThreads.add(event.session_thread_id);
                startTyping(conversation);
            }
            return;

        case "agent.thread_message_received":
            if (event.from_agent_name === ADVISOR_THREAD) conversation.advisorThreads.add(event.from_session_thread_id);
            return;

        case "session.status_running":
            conversation.running = true;
            conversation.typingDelay ??= setTimeout(() => startTyping(conversation), TYPING_DELAY_MS);
            return;

        case "session.status_idle": {
            conversation.running = false;
            if (conversation.switching) return; // the old session; the new one takes over
            stopTyping(conversation);
            const skipped = conversation.skipped;
            if (event.stop_reason.type !== "requires_action") {
                logTurn(conversation);
                if (conversation.usedTools) {
                    conversation.usedTools = false;
                    void postOutputs(conversation);
                }
            }
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
            if (skipped && conversation.unanswered >= UNANSWERED_BEFORE_SLEEP) {
                await end(conversation, `after detecting ${conversation.unanswered} unrelated messages`, true);
                return;
            }
            await postFooter(conversation);
            resetIdleTimer(conversation);
            return;
        }

        case "session.status_terminated":
            await end(conversation, "session ended");
            return;

        case "session.error":
            console.error(`[chat] ${conversation.label} session error:`, event);
            return;
    }
}

/**
 * Attaches the files Claude wrote to /mnt/session/outputs/ in Discord. Runs
 * after a turn that used the sandbox. Files show up in the Files API a moment
 * after the turn ends, so it waits a little first.
 */
async function postOutputs(conversation: Conversation): Promise<void> {
    await sleep(OUTPUTS_DELAY_MS);
    const {channel, sessionId} = conversation;
    const fresh: BetaFileMetadata[] = [];
    try {
        for await (const file of api().beta.files.list({scope_id: sessionId, betas: ["managed-agents-2026-04-01"]})) {
            if (conversation.postedFiles.has(file.id) || Date.parse(file.created_at) < conversation.outputsSince) continue;
            conversation.postedFiles.add(file.id);
            fresh.push(file);
        }
    } catch (err) {
        console.error(`[chat] ${conversation.label} couldn't list output files:`, err);
        return;
    }
    if (fresh.length === 0) return;

    const files: { attachment: Buffer; name: string }[] = [];
    const left: string[] = []; // too big, or failed to download
    for (const file of fresh) {
        const name = basename(file.filename);
        if (file.size_bytes > MAX_UPLOAD_BYTES) {
            left.push(`${name} (too big)`);
            continue;
        }
        try {
            const response = await api().beta.files.download(file.id);
            files.push({attachment: Buffer.from(await response.arrayBuffer()), name});
        } catch (err) {
            console.error(`[chat] ${conversation.label} couldn't download ${name}:`, err);
            left.push(`${name} (couldn't download)`);
        }
    }
    for (let i = 0; i < files.length; i += DISCORD_FILES) {
        await channel.send({files: files.slice(i, i + DISCORD_FILES)}).catch((err: unknown) => {
            console.error(`[chat] ${conversation.label} couldn't attach output files:`, err);
        });
    }
    if (left.length > 0) {
        await channel.send({
            content: `-# Not attached: ${left.join(", ")}. Discord takes up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB per file.`,
            allowedMentions: {parse: []},
        }).catch(() => {
        });
    }
    log(conversation, `attached ${files.length} output file${files.length === 1 ? "" : "s"}`);
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
    const thread = await anchor.startThread({name, autoArchiveDuration: THREAD_ARCHIVE});

    // Re-key it: messages in the thread now reach this conversation, and the
    // channel's no longer do. Typing and replies follow conversation.channel.
    conversations.delete(channel.id);
    deleteStored(channel.id);
    conversation.channel = thread;
    conversation.label = `#${thread.name}`;
    conversations.set(thread.id, conversation);
    remember(conversation);
    log(conversation, `moved here from #${channel.name}`);

    return {text: `Moved. This conversation now continues in the thread <#${thread.id}> ("${thread.name}"): your replies go there, and messages in <#${channel.id}> no longer reach you. ${THREAD_NOTE}`};
}

/**
 * The bot shows as online while any conversation is awake, and idle while
 * they're all asleep. Only the status changes; an activity set with /sudo
 * presence stays.
 */
function syncPresence(client: Client<true>): void {
    const status = conversations.size > 0 ? "online" : "idle";
    if (client.user.presence.status !== status) client.user.setStatus(status);
}

/** The bot's name in this server: its nickname if it has one ("Claude"), else its username. */
function botName(channel: GuildTextBasedChannel): string {
    return channel.guild.members.me?.displayName ?? channel.client.user.displayName;
}

/** Runs a tool call, sends its result back, then releases any queued messages. */
async function runCustomTool(conversation: Conversation, event: CustomToolUse): Promise<void> {
    const sessionId = conversation.sessionId;
    let result: ToolResult;
    try {
        if (event.name === "escalate") {
            const failed = await escalateTool(conversation, event.input);
            if (!failed) return; // the session that asked is gone
            result = failed;
        } else if (event.name === "start_thread") {
            result = await moveToThread(conversation, event.input);
        } else {
            result = await runTool(event.name, event.input, {
                channel: conversation.channel,
                lastMessage: conversation.lastMessage,
                later: (outcome) => deliverLater(conversation, outcome),
            });
        }
    } catch (err) {
        result = {text: `The tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true};
    }
    log(conversation, `used ${event.name}${result.isError ? " (failed)" : ""}`);
    // Ended, or escalated meanwhile: nobody is waiting for this result.
    if (conversation.ended || conversation.sessionId !== sessionId) return;

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
    await flushQueued(conversation);
}

/** The escalate tool: null once the conversation has moved, else why it didn't. */
async function escalateTool(conversation: Conversation, input: Record<string, unknown>): Promise<ToolResult | null> {
    if (conversation.escalated || conversation.switching) {
        return {text: "This conversation is already escalated.", isError: true};
    }
    const reason = typeof input.reason === "string" && input.reason.trim() ? truncate(input.reason.trim(), 100) : null;
    const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null;
    if (await escalateConversation(conversation, reason, notes)) return null;
    return {text: "Couldn't escalate right now (the channel was told why). Carry on yourself.", isError: true};
}

/**
 * A tool outcome that comes after the tool returned (a confirmation button's),
 * told to Claude as a system message once it's in. The conversation stays
 * awake meanwhile.
 */
function deliverLater(conversation: Conversation, outcome: Promise<string>): void {
    conversation.waiting++;
    void outcome
        .then((text) => relay(conversation, [{type: "system.message", content: [{type: "text", text}]}]))
        .catch((err: unknown) => {
            console.error(`[chat] ${conversation.label} couldn't deliver a tool outcome:`, err);
        })
        .finally(() => {
            conversation.waiting--;
        });
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
    const advisorCalls = conversation.advisorThreads.size;
    conversation.lastReply = null;
    conversation.advisorThreads.clear();
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
        // Don't fall asleep mid-answer, mid-tool, mid-escalation or while a
        // button waits; check again once it's done.
        if (conversation.running || conversation.pendingTools > 0 || conversation.switching || conversation.waiting > 0) {
            resetIdleTimer(conversation);
            return;
        }
        void end(conversation, null, true);
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
    const calls = conversation.advisorThreads.size;
    const advisor = calls > 0 ? `, asked the advisor ${calls}x` : "";
    const cached = conversation.inputTokens > 0
        ? `, ${Math.round((conversation.cachedTokens / conversation.inputTokens) * 100)}% cached`
        : "";
    log(conversation, `${what}${advisor}, context ${formatTokens(conversation.contextTokens)}${cached}`);
    conversation.replies = 0;
    conversation.skipped = false;
    conversation.cachedTokens = 0;
    conversation.inputTokens = 0;
}

/**
 * Stops listening. A conversation put to sleep (`resumable`) keeps its
 * session, and a mention within RESUME_WINDOW_MS wakes it up. One that ends
 * for good has its session archived.
 */
async function end(conversation: Conversation, reason: string | null = null, resumable = false): Promise<void> {
    if (conversation.ended) return;
    conversation.ended = true;

    conversations.delete(conversation.channel.id);
    syncPresence(conversation.channel.client);
    reservedCents -= conversation.budgetCents;
    if (conversation.idleTimer) clearTimeout(conversation.idleTimer);
    stopTyping(conversation);
    conversation.stream?.abort();
    // Saved before anything is awaited: a mention right after this has to find
    // it asleep (or gone), and waking it up must not be undone afterwards.
    if (resumable) remember(conversation, Date.now());
    else deleteStored(conversation.channel.id);

    const [spent, month] = await Promise.all([spentCents(conversation.sessionId), monthSpentCents()]);
    if (!resumable) await archive(conversation.label, conversation.sessionId);
    log(
        conversation,
        `${resumable ? "went to sleep" : "ended"} (${reason ?? "idle"}): ${spent === null ? "?" : formatCents(spent)} spent, ` +
        `${month === null ? "?" : formatCents(month)} this month`,
    );

    // The conversation's own line follows the footer's rule; the month always shows.
    const own = spent !== null && showsUsage(conversation)
        ? {spent, budget: conversation.budgetCents}
        : null;
    const message = sleepMessage(botName(conversation.channel), reason, month, own, resumable ? RESUME_WINDOW_MS : null);
    await conversation.channel.send(message).catch(() => {
    });
}
