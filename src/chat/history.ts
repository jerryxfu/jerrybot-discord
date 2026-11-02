import type {Message} from "discord.js";
import {truncate} from "../utils/truncate.js";
import {HISTORY_MAX_AGE_MS, HISTORY_MAX_CHARS, HISTORY_MESSAGES, TIMEZONE} from "./config.js";

const TIME = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
});

/** "2026-10-31, 22:27 EDT", in the server's time zone. */
export function formatTime(date: Date): string {
    return TIME.format(date);
}

/**
 * "[message id] Name <@id>: text", with "(replying to Sam)" after the mention
 * for a Discord reply, plus any attachment URLs. So the agent knows who said
 * what to whom, can mention people by their <@id>, and can reply to or react
 * to a message by its ID.
 */
export function formatMessage(message: Message): string {
    const name = message.member?.displayName ?? message.author.displayName;
    const repliedTo = message.mentions.repliedUser;
    const to = !repliedTo ? ""
        : repliedTo.id === message.client.user.id ? " (replying to you)"
            : ` (replying to ${message.guild?.members.cache.get(repliedTo.id)?.displayName ?? repliedTo.displayName})`;
    const attachments = [...message.attachments.values()].map((a) => a.url);
    return [`[${message.id}] ${name} <@${message.author.id}>${to}: ${withMentionNames(message)}`, ...attachments].join("\n");
}

/** The text with each user mention as "@Name <@id>", so both the name and the ID survive. */
function withMentionNames(message: Message): string {
    return message.content.replace(/<@!?(\d+)>/g, (_, id: string) => {
        const name = message.guild?.members.cache.get(id)?.displayName
            ?? message.mentions.users.get(id)?.displayName
            ?? "someone";
        return `@${name} <@${id}>`;
    });
}

/**
 * Up to HISTORY_MESSAGES channel messages from just before `message`, oldest
 * first, formatted like relayed messages. Skips anything older than
 * HISTORY_MAX_AGE_MS, or than `since` (epoch ms) when given. The bot's own
 * messages are included as they are.
 */
export async function recentMessages(message: Message<true>, since?: number): Promise<string[]> {
    let fetched;
    try {
        fetched = await message.channel.messages.fetch({limit: HISTORY_MESSAGES, before: message.id});
    } catch {
        return []; // e.g. missing Read Message History permission
    }

    const cutoff = since ?? message.createdTimestamp - HISTORY_MAX_AGE_MS;
    return [...fetched.values()]
        .filter((m) => m.createdTimestamp >= cutoff)
        .filter((m) => m.cleanContent.trim() || m.attachments.size > 0)
        .reverse() // fetch returns newest first
        .map((m) => truncate(formatMessage(m), HISTORY_MAX_CHARS));
}

/** Prefixes the first message of a conversation with the channel's recent history. */
export function withHistory(
    history: string[],
    text: string,
    header = "(Recent messages before you were mentioned, oldest first:)",
): string {
    if (history.length === 0) return text;
    return `${header}\n${history.join("\n")}\n\n${text}`;
}
