import {truncate} from "../utils/truncate.js";

// Keywords right after the @mention, in any order: "@Claude thread escalate ...".
// "ultrathink" is an alias of "escalate", "clear" of "reset". "stop", "sleep"
// and "reset" control the channel's conversation (see handleChatMessage).
const KEYWORD = /^(escalate|ultrathink|thread|stop|sleep|reset|clear)\b[\s,:]*/i;

/**
 * The keywords at the start of a message, after any @mentions, plus the text
 * that follows them: "<@1> thread escalate why?" -> both, "why?".
 */
export function parseKeywords(content: string): {
    escalate: boolean;
    thread: boolean;
    stop: boolean;
    sleep: boolean;
    reset: boolean;
    rest: string;
} {
    let rest = content.replace(/^(\s*<@[!&]?\d+>)+/, "").trim();
    let escalate = false;
    let thread = false;
    let stop = false;
    let sleep = false;
    let reset = false;
    for (let match = KEYWORD.exec(rest); match; match = KEYWORD.exec(rest)) {
        const word = match[1]?.toLowerCase();
        if (word === "escalate" || word === "ultrathink") escalate = true;
        if (word === "thread") thread = true;
        if (word === "stop") stop = true;
        if (word === "sleep") sleep = true;
        if (word === "reset" || word === "clear") reset = true;
        rest = rest.slice(match[0].length);
    }
    return {escalate, thread, stop, sleep, reset, rest};
}

/** A thread title from the message: its first line without mentions, cut to fit. */
export function threadName(rest: string, botName: string): string {
    const line = rest.split("\n")[0]?.replace(/<@[!&]?\d+>/g, "").replace(/\s+/g, " ").trim() ?? "";
    return truncate(line, 80) || `Chat with ${botName}`;
}
