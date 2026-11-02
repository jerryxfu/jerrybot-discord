import {mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";

/**
 * Every chat session the bot hasn't archived yet, by channel (or thread) ID:
 * the ones running now and the ones asleep, waiting to be picked up again by
 * a mention. Kept in data/ (gitignored) so it survives restarts and redeploys.
 */
const FILE = resolve(import.meta.dirname, "../../data/chat-sessions.json");

export interface StoredSession {
    sessionId: string;
    escalated: boolean;
    budgetCents: number;
    contextTokens: number;
    sleptAt: number | null; // epoch ms it went to sleep; null while awake
}

let sessions: Record<string, StoredSession> | null = null;

function load(): Record<string, StoredSession> {
    if (!sessions) {
        try {
            sessions = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, StoredSession>;
        } catch {
            sessions = {}; // none yet, or unreadable: start over rather than crash
        }
    }
    return sessions;
}

/** Written whole on every change; it's a handful of entries. Never throws. */
function save(): void {
    try {
        mkdirSync(dirname(FILE), {recursive: true});
        writeFileSync(`${FILE}.tmp`, JSON.stringify(load(), null, 2));
        renameSync(`${FILE}.tmp`, FILE); // a crash mid-write can't leave half a file
    } catch (err) {
        console.error("[chat] couldn't save the session list:", err);
    }
}

export function storedSessions(): [string, StoredSession][] {
    return Object.entries(load());
}

export function getStored(channelId: string): StoredSession | undefined {
    return load()[channelId];
}

export function putStored(channelId: string, session: StoredSession): void {
    load()[channelId] = session;
    save();
}

export function deleteStored(channelId: string): void {
    if (!(channelId in load())) return;
    delete load()[channelId];
    save();
}
