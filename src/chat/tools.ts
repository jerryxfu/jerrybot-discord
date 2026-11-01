import type {BetaManagedAgentsCustomToolParams} from "@anthropic-ai/sdk/resources/beta/agents/agents";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ComponentType,
    type Guild,
    type GuildBasedChannel,
    type GuildMember,
    type GuildTextBasedChannel,
    type Message,
    PermissionFlagsBits,
} from "discord.js";
import {truncate} from "../utils/truncate.js";
import {ISSUE_CONFIRM_MS, READ_MESSAGES_MAX, TECHNEXUS_REPO} from "./config.js";
import {formatMessage, formatTime} from "./history.js";

/**
 * Custom tools: Claude asks for them, the bot runs them here with its own
 * Discord and GitHub access, and the result goes back to the session. Tokens
 * never enter the sandbox.
 *
 * Reading is checked against the person asking: Claude can read a channel only
 * if the author of the latest message it got can see it.
 */

export const CUSTOM_TOOLS: BetaManagedAgentsCustomToolParams[] = [
    {
        // Handled in conversation.ts, since it moves the conversation itself.
        type: "custom",
        name: "start_thread",
        description:
            "Move this conversation into a new Discord thread, started from a message in the channel. You keep " +
            "everything said so far; from then on your replies and the conversation happen in the thread, and the " +
            "channel is free again. Not available inside a thread.",
        input_schema: {
            type: "object",
            properties: {
                name: {type: "string", maxLength: 80, description: "Short thread title, like the topic."},
                message_id: {type: "string", description: "Message to start the thread from. Defaults to the latest message you received."},
            },
            required: ["name"],
        },
    },
    {
        type: "custom",
        name: "list_channels",
        description: "List this server's text channels that the person asking can see, with their IDs and topics.",
        input_schema: {type: "object", properties: {}},
    },
    {
        type: "custom",
        name: "read_messages",
        description:
            "Read recent messages from a channel or thread in this server, oldest first, as " +
            "\"time [message id] Name <@id>: text\". Use it to look further back than you can see, or at another channel. " +
            "Only works for channels the person asking can see.",
        input_schema: {
            type: "object",
            properties: {
                channel: {type: "string", description: "Channel name (like \"general\") or ID. Defaults to this conversation's channel."},
                limit: {type: "integer", minimum: 1, maximum: READ_MESSAGES_MAX, description: "How many messages, default 20."},
                before: {type: "string", description: "A message ID: read messages before it, to page further back."},
            },
        },
    },
    {
        type: "custom",
        name: "react",
        description:
            "Add an emoji reaction to a message. Defaults to the latest message you received; pass message_id " +
            "(the [id] in front of each message) to react to another one.",
        input_schema: {
            type: "object",
            properties: {
                emoji: {type: "string", description: "A Unicode emoji, or the name of one of this server's custom emojis."},
                message_id: {type: "string"},
                channel: {type: "string", description: "Channel name or ID of message_id, if it's not in this channel."},
            },
            required: ["emoji"],
        },
    },
    {
        type: "custom",
        name: "create_issue",
        description:
            `Open an issue in the private TechNexus repo (${TECHNEXUS_REPO}), for example to turn a discussion into ` +
            "a todo list. Someone in the channel must confirm with a button before it's created, and the result " +
            "says whether it was. Write a clear title and a Markdown body; use a checklist (- [ ] item) for todos.",
        input_schema: {
            type: "object",
            properties: {
                title: {type: "string", maxLength: 256},
                body: {type: "string"},
            },
            required: ["title", "body"],
        },
    },
    {
        type: "custom",
        name: "list_issues",
        description:
            "List or search issues in the private TechNexus repo. Without a query: the 30 most recently updated. " +
            "With a query: a GitHub issue search (words, label:bug, author:name, ...).",
        input_schema: {
            type: "object",
            properties: {
                query: {type: "string"},
                state: {type: "string", enum: ["open", "closed", "all"], description: "Default open."},
            },
        },
    },
    {
        type: "custom",
        name: "read_issue",
        description: "Read a TechNexus issue: its description and comments.",
        input_schema: {
            type: "object",
            properties: {number: {type: "integer", minimum: 1}},
            required: ["number"],
        },
    },
    {
        type: "custom",
        name: "comment_on_issue",
        description:
            "Comment on an existing TechNexus issue, for example to add what was decided in a discussion. " +
            "Someone in the channel must confirm with a button first, and the result says whether it was posted.",
        input_schema: {
            type: "object",
            properties: {
                number: {type: "integer", minimum: 1},
                body: {type: "string", description: "Markdown."},
            },
            required: ["number", "body"],
        },
    },
];

/** What a tool call needs from the conversation it happens in. */
export interface ToolContext {
    channel: GuildTextBasedChannel; // where the conversation is
    lastMessage: Message<true> | null; // latest message relayed to Claude; its author is "the person asking"
}

export interface ToolResult {
    text: string;
    isError?: boolean;
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    switch (name) {
        case "list_channels":
            return listChannels(ctx);
        case "read_messages":
            return readMessages(input, ctx);
        case "react":
            return react(input, ctx);
        case "create_issue":
            return createIssue(input, ctx);
        case "list_issues":
            return listIssues(input);
        case "read_issue":
            return readIssue(input);
        case "comment_on_issue":
            return commentOnIssue(input, ctx);
        default:
            return {text: `Unknown tool: ${name}`, isError: true};
    }
}

function listChannels(ctx: ToolContext): ToolResult {
    const asker = ctx.lastMessage?.member ?? null;
    const lines = ctx.channel.guild.channels.cache
        .filter((c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) && canRead(c, asker))
        .sort((a, b) => ("rawPosition" in a && "rawPosition" in b ? a.rawPosition - b.rawPosition : 0))
        .map((c) => `#${c.name} (${c.id})${"topic" in c && c.topic ? `: ${truncate(c.topic, 100)}` : ""}`);
    return {text: lines.length > 0 ? lines.join("\n") : "No channels the person asking can see."};
}

async function readMessages(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const asker = ctx.lastMessage?.member ?? null;
    const channel = await findChannel(ctx, text(input.channel));
    if (!channel) return {text: `No channel called "${text(input.channel)}".`, isError: true};
    if (!canRead(channel, asker)) {
        return {text: `Can't read #${channel.name}: the person asking can't see it, or I can't.`, isError: true};
    }

    const limit = Math.min(Math.max(Math.trunc(Number(input.limit) || 20), 1), READ_MESSAGES_MAX);
    const before = text(input.before);
    const fetched = await channel.messages.fetch({limit, ...(before ? {before} : {})});
    const lines = [...fetched.values()]
        .reverse() // fetch returns newest first
        .map((m) => `${formatTime(m.createdAt)} ${truncate(formatMessage(m), 500)}`);
    if (lines.length === 0) return {text: `No messages in #${channel.name}${before ? " before that one" : ""}.`};
    const count = `${lines.length} message${lines.length === 1 ? "" : "s"}`;
    return {text: `#${channel.name}, ${count}, oldest first:\n${lines.join("\n")}`};
}

async function react(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const emoji = text(input.emoji);
    if (!emoji) return {text: "No emoji given.", isError: true};

    let target: Message | null = ctx.lastMessage;
    const messageId = text(input.message_id);
    if (messageId) {
        const channel = await findChannel(ctx, text(input.channel));
        if (!channel || !canRead(channel, ctx.lastMessage?.member ?? null)) {
            return {text: "Can't find that channel, or the person asking can't see it.", isError: true};
        }
        target = await channel.messages.fetch(messageId).catch(() => null);
    }
    if (!target) return {text: "Couldn't find that message.", isError: true};

    // A custom emoji goes by its ID; ":name:" and "name" both work.
    const custom = ctx.channel.guild.emojis.cache.find((e) => e.name === emoji.replace(/:/g, ""));
    try {
        await target.react(custom ?? emoji);
    } catch {
        return {text: `Couldn't react with "${emoji}". Use a Unicode emoji or a custom emoji from this server.`, isError: true};
    }
    return {text: "Reacted."};
}

// --- GitHub: TechNexus issues ---------------------------------------------

interface Issue {
    number: number;
    title: string;
    state: string;
    html_url: string;
    body: string | null;
    user: { login: string } | null;
    labels: { name: string }[];
    comments: number;
    updated_at: string;
    pull_request?: unknown; // the issues API lists pull requests too
}

interface Comment {
    html_url: string;
    body: string;
    user: { login: string } | null;
    created_at: string;
}

const NO_TOKEN: ToolResult = {text: "GitHub isn't set up (no GITHUB_TOKEN), so issues aren't available.", isError: true};

async function listIssues(input: Record<string, unknown>): Promise<ToolResult> {
    const state = ["open", "closed", "all"].includes(String(input.state)) ? String(input.state) : "open";
    const query = text(input.query);
    const search = `repo:${TECHNEXUS_REPO} is:issue${state === "all" ? "" : ` is:${state}`} ${query ?? ""}`;
    const result = query
        ? await github<{ items: Issue[] }>("GET", `/search/issues?q=${encodeURIComponent(search)}&per_page=20`)
        : await github<Issue[]>("GET", `/repos/${TECHNEXUS_REPO}/issues?state=${state}&per_page=30`);
    if (!result.ok) return githubError(result);

    const issues = (Array.isArray(result.data) ? result.data : result.data.items).filter((i) => !i.pull_request);
    if (issues.length === 0) return {text: query ? `No ${state} issues match "${query}".` : `No ${state} issues.`};
    return {
        text: issues.map((i) => {
            const labels = i.labels.length > 0 ? ` [${i.labels.map((l) => l.name).join(", ")}]` : "";
            return `#${i.number} (${i.state}) ${i.title}${labels}, ${i.comments} comments, updated ${i.updated_at.slice(0, 10)}`;
        }).join("\n"),
    };
}

async function readIssue(input: Record<string, unknown>): Promise<ToolResult> {
    const number = issueNumber(input.number);
    if (!number) return {text: "Give an issue number.", isError: true};
    const issue = await github<Issue>("GET", `/repos/${TECHNEXUS_REPO}/issues/${number}`);
    if (!issue.ok) return githubError(issue);
    const comments = await github<Comment[]>("GET", `/repos/${TECHNEXUS_REPO}/issues/${number}/comments?per_page=100`);
    if (!comments.ok) return githubError(comments);

    const i = issue.data;
    const shown = comments.data.slice(-20);
    const lines = [
        `#${i.number} (${i.state}) ${i.title}`,
        `by ${i.user?.login ?? "?"}${i.labels.length > 0 ? `, labels: ${i.labels.map((l) => l.name).join(", ")}` : ""}, ${i.html_url}`,
        "",
        truncate(i.body?.trim() || "(no description)", 4000),
        "",
        comments.data.length === 0 ? "No comments."
            : `Comments${comments.data.length > shown.length ? ` (last ${shown.length} of ${comments.data.length})` : ""}:`,
        ...shown.map((c) => `- ${c.user?.login ?? "?"} (${c.created_at.slice(0, 10)}): ${truncate(c.body, 1000)}`),
    ];
    return {text: lines.join("\n")};
}

async function createIssue(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!process.env.GITHUB_TOKEN) return NO_TOKEN;
    const title = text(input.title)?.slice(0, 256);
    const body = text(input.body) ?? "";
    if (!title) return {text: "An issue needs a title.", isError: true};

    const confirmed = await confirm(ctx, `**Create this issue in ${TECHNEXUS_REPO}?**\n### ${title}\n${truncate(body, 1500)}`, "Create");
    if ("text" in confirmed) return confirmed;

    const created = await github<Issue>("POST", `/repos/${TECHNEXUS_REPO}/issues`, {title, body});
    if (!created.ok) {
        await confirmed.done(`GitHub refused it (${created.status}).`);
        return githubError(created);
    }
    const issue = created.data;
    await confirmed.done(`✅ Created [#${issue.number}](<${issue.html_url}>), confirmed by ${confirmed.who}.`);
    return {text: `Created issue #${issue.number}: ${issue.html_url} (confirmed by ${confirmed.who}).`};
}

async function commentOnIssue(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!process.env.GITHUB_TOKEN) return NO_TOKEN;
    const number = issueNumber(input.number);
    const body = text(input.body);
    if (!number || !body) return {text: "Give an issue number and the comment.", isError: true};

    // Look it up first, so the preview shows which issue and a wrong number fails early.
    const issue = await github<Issue>("GET", `/repos/${TECHNEXUS_REPO}/issues/${number}`);
    if (!issue.ok) return githubError(issue);

    const confirmed = await confirm(ctx, `**Comment on #${number} ${issue.data.title}?**\n${truncate(body, 1700)}`, "Post");
    if ("text" in confirmed) return confirmed;

    const posted = await github<Comment>("POST", `/repos/${TECHNEXUS_REPO}/issues/${number}/comments`, {body});
    if (!posted.ok) {
        await confirmed.done(`GitHub refused it (${posted.status}).`);
        return githubError(posted);
    }
    await confirmed.done(`✅ Posted [the comment](<${posted.data.html_url}>) on #${number}, confirmed by ${confirmed.who}.`);
    return {text: `Posted the comment on #${number}: ${posted.data.html_url} (confirmed by ${confirmed.who}).`};
}

/**
 * Posts `preview` with an action button and Cancel. Anyone in the channel can
 * click; nothing happens without a click. Resolves to who confirmed and a way
 * to note the outcome under the preview, or to a result saying why not.
 */
async function confirm(
    ctx: ToolContext,
    preview: string,
    action: string,
): Promise<{ who: string; done: (note: string) => Promise<void> } | ToolResult> {
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("confirm").setLabel(action).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );
    const prompt = await ctx.channel.send({content: preview, components: [buttons], allowedMentions: {parse: []}});
    const note = async (text: string) => {
        await prompt.edit({content: `${preview}\n-# ${text}`, components: []}).catch(() => {
        });
    };

    let click;
    try {
        click = await prompt.awaitMessageComponent({componentType: ComponentType.Button, time: ISSUE_CONFIRM_MS});
    } catch {
        await note("Nobody confirmed, so nothing was done.");
        return {text: "Nobody confirmed in time, so nothing was done."};
    }

    const who = click.member && "displayName" in click.member ? click.member.displayName : click.user.displayName;
    if (click.customId === "cancel") {
        await click.update({content: `${preview}\n-# Cancelled by ${who}.`, components: []});
        return {text: `${who} cancelled it, so nothing was done.`};
    }
    await click.update({content: `${preview}\n-# Working on it...`, components: []});
    return {who, done: note};
}

type GitHubResult<T> = { ok: true; data: T } | { ok: false; status: number; detail: string };

async function github<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<GitHubResult<T>> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return {ok: false, status: 0, detail: NO_TOKEN.text};
    const response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "jerrybot-discord",
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (!response.ok) return {ok: false, status: response.status, detail: truncate(await response.text(), 300)};
    return {ok: true, data: (await response.json()) as T};
}

function githubError(result: { status: number; detail: string }): ToolResult {
    if (result.status === 404) return {text: "Not found: no such issue in TechNexus.", isError: true};
    return {text: result.status ? `GitHub returned ${result.status}: ${result.detail}` : result.detail, isError: true};
}

function issueNumber(value: unknown): number | null {
    const number = Math.trunc(Number(value));
    return number > 0 ? number : null;
}

/** A text channel or thread by ID, <#mention>, name or #name; the conversation's channel when empty. */
async function findChannel(ctx: ToolContext, ref: string | undefined): Promise<GuildTextBasedChannel | null> {
    if (!ref) return ctx.channel;
    const guild: Guild = ctx.channel.guild;
    const id = ref.match(/^<#(\d+)>$/)?.[1] ?? (/^\d+$/.test(ref) ? ref : null);
    const name = ref.replace(/^#/, "").toLowerCase();
    const found = id
        ? guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null))
        : guild.channels.cache.find((c) => c.name.toLowerCase() === name && c.isTextBased());
    return found?.isTextBased() ? found : null;
}

/** Both the person asking and the bot can view the channel and read its history. */
function canRead(channel: GuildBasedChannel, asker: GuildMember | null): boolean {
    const me = channel.guild.members.me;
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
    return !!asker && !!me && !!channel.permissionsFor(asker)?.has(needed) && !!channel.permissionsFor(me)?.has(needed);
}

function text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
