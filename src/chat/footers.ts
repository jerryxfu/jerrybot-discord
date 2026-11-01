import {MONTHLY_LIMIT_CENTS} from "./config.js";

/** The small "-#" status lines the bot adds to Discord, and their formatting. */

/**
 * The footer lines for a turn, or null if there's nothing to show:
 *   -# 💡 Haiku 5.5 asked Opus 5.5 for advice (2)
 *   -# Haiku 5.5 context 95K/180K (53%) ||$0.80/$1.50||
 */
export function turnFooter(
    advisor: { model: string; advisor: string; calls: number } | null,
    usage: { model: string; contextTokens: number; contextLimit: number; spent: number | null; budget: number } | null,
): string | null {
    const lines: string[] = [];
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
 * "-# Claude is going to sleep 😴... (reason) ||$12.30/$98.00||", plus a second
 * "-# ||$0.84/$1.50||" line for this conversation's own spend when given.
 */
export function sleepMessage(
    name: string,
    reason: string | null,
    monthCents: number | null,
    conversation: { spent: number; budget: number } | null,
): string {
    const why = reason ? ` (${reason})` : "";
    const month = monthCents === null ? "" : ` ${spoilerCost(monthCents, MONTHLY_LIMIT_CENTS)}`;
    const lines = [`-# ${name} is going to sleep 😴...${why}${month}`];
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

export function formatCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

/** "||$0.84/$1.50||": a Discord spoiler, so prices only show when clicked. */
function spoilerCost(cents: number, limitCents: number): string {
    return `||${formatCents(cents)}/${formatCents(limitCents)}||`;
}
