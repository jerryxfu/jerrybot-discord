import {truncate} from "../utils/truncate.js";

// Keywords right after the @mention, in any order: "@Claude thread ultrathink ..."
const KEYWORD = /^(ultrathink|thread)\b[\s,:]*/i;

/**
 * The keywords at the start of a message, after any @mentions, plus the text
 * that follows them: "<@1> thread ultrathink why?" -> both, "why?".
 */
export function parseKeywords(content: string): { ultrathink: boolean; thread: boolean; rest: string } {
    let rest = content.replace(/^(\s*<@[!&]?\d+>)+/, "").trim();
    let ultrathink = false;
    let thread = false;
    for (let match = KEYWORD.exec(rest); match; match = KEYWORD.exec(rest)) {
        const word = match[1]?.toLowerCase();
        if (word === "ultrathink") ultrathink = true;
        if (word === "thread") thread = true;
        rest = rest.slice(match[0].length);
    }
    return {ultrathink, thread, rest};
}

/** A thread title from the message: its first line without mentions, cut to fit. */
export function threadName(rest: string, botName: string): string {
    const line = rest.split("\n")[0]?.replace(/<@[!&]?\d+>/g, "").replace(/\s+/g, " ").trim() ?? "";
    return truncate(line, 80) || `Chat with ${botName}`;
}
