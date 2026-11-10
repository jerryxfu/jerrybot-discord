import {MONTHLY_LIMIT_CENTS} from "./config.js";

/** The small "-#" status lines the bot adds to Discord, and their formatting. */

/**
 * The footer lines for a turn, or null if there's nothing to show:
 *   -# 🧠 thought for 14s
 *   -# 💡 Haiku 5.5 asked Opus 5.5 for advice (2)
 *   -# Haiku 5.5 context 210K/400K (53%) ||$1.60/$3.00||
 */
export function turnFooter(
    thinkingMs: number,
    advisor: { model: string; advisor: string; calls: number } | null,
    usage: { model: string; contextTokens: number; contextLimit: number; spent: number | null; budget: number } | null,
): string | null {
    const lines: string[] = [];
    if (thinkingMs >= 1000) lines.push(`-# 🧠 thought for ${formatSeconds(thinkingMs)}`);
    if (advisor) {
        lines.push(`-# 💡 ${modelName(advisor.model)} asked ${modelName(advisor.advisor)} for advice (${advisor.calls})`);
    }
    if (usage) {
        const percent = Math.round((usage.contextTokens / usage.contextLimit) * 100);
        const context = `context ${formatTokens(usage.contextTokens)}/${formatTokens(usage.contextLimit)} (${percent}%)`;
        const cost = usage.spent === null ? "" : ` ${spoilerCost(usage.spent, usage.budget)}`;
        lines.push(`-# ${modelName(usage.model)} ${context}${cost}`);
    }
    return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * "-# Claude is going to sleep 😴... (reason) · mention me within 1h to pick
 * this back up ||$12.30/$98.00||", plus a second "-# ||$0.84/$1.50||" line for
 * this conversation's own spend when given. The middle part shows when it can
 * be woken up (resumeMs, how long for). A reason starting with "after" reads
 * as part of the sentence instead: "going to sleep after detecting 15
 * unrelated messages 😴...".
 */
export function sleepMessage(
    name: string,
    reason: string | null,
    monthCents: number | null,
    conversation: { spent: number; budget: number } | null,
    resumeMs: number | null,
): string {
    const after = reason?.startsWith("after ") ? ` ${reason}` : "";
    const why = reason && !after ? ` (${reason})` : "";
    const resume = resumeMs === null ? "" : ` · mention me within ${Math.round(resumeMs / 3_600_000)}h to pick this back up`;
    const month = monthCents === null ? "" : ` ${spoilerCost(monthCents, MONTHLY_LIMIT_CENTS)}`;
    const lines = [`-# ${name} is going to sleep${after} 😴...${why}${resume}${month}`];
    if (conversation) lines.push(`-# ${spoilerCost(conversation.spent, conversation.budget)}`);
    return lines.join("\n");
}

/** "claude-haiku-5-5" -> "Haiku 5.5" */
export function modelName(id: string): string {
    const [family = id, ...version] = id.replace(/^claude-/, "").split("-");
    return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join(".")}`.trim();
}

export function formatTokens(tokens: number): string {
    return tokens < 1000 ? String(tokens) : `${Math.round(tokens / 1000)}K`;
}

/** 14_200 -> "14s", 125_000 -> "2m 5s" */
export function formatSeconds(ms: number): string {
    const seconds = Math.round(ms / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

/** "||$0.84/$1.50||": a Discord spoiler, so prices only show when clicked. */
function spoilerCost(cents: number, limitCents: number): string {
    return `||${formatCents(cents)}/${formatCents(limitCents)}||`;
}
