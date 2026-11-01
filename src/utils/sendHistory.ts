import {appendFile, mkdir, readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";

/**
 * Append-only log of everything done through /send, one JSON object per line.
 * Lives outside src/ so it survives redeploys (data/ is gitignored).
 */
const FILE = resolve(import.meta.dirname, "../../data/send-history.jsonl");

export type SendKind = "message" | "thinking";

export interface SendEntry {
    at: number; // epoch ms
    kind: SendKind;
    guildId: string | null;
    channelId: string;
    userId: string;
    content: string;
}

/** Records an entry. Never throws: a failed log shouldn't fail the command. */
export async function logSend(entry: SendEntry): Promise<void> {
    try {
        await mkdir(dirname(FILE), {recursive: true});
        await appendFile(FILE, JSON.stringify(entry) + "\n");
    } catch (err) {
        console.error("Failed to write send history:", err);
    }
}

/** Returns the newest `limit` entries matching `filter`, newest first. */
export async function readSends(
    filter: (entry: SendEntry) => boolean,
    limit: number,
): Promise<SendEntry[]> {
    let raw: string;
    try {
        raw = await readFile(FILE, "utf8");
    } catch {
        return []; // no history yet
    }

    const entries: SendEntry[] = [];
    for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
            entries.push(JSON.parse(line) as SendEntry);
        } catch {
            // skip a corrupt line rather than losing the whole log
        }
    }

    return entries.filter(filter).slice(-limit).reverse();
}
