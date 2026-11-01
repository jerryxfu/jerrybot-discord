import {api} from "./api.js";
import {MIN_SESSION_CENTS, MONTHLY_LIMIT_CENTS} from "./config.js";

/** A session's spend so far in US cents, or null if it can't be read. */
export async function spentCents(sessionId: string): Promise<number | null> {
    try {
        const session = await api().beta.sessions.retrieve(sessionId);
        const cost = session.usage.list_cost;
        return cost ? Number(cost.amount) : 0;
    } catch {
        return null;
    }
}

/**
 * Spend of every chat session created this calendar month (UTC), in US cents,
 * or null if the sessions can't be listed. Read from Anthropic rather than
 * tracked locally, so it survives restarts and includes dev runs.
 */
export async function monthSpentCents(): Promise<number | null> {
    const agentId = process.env.CHAT_AGENT_ID;
    if (!agentId) return null;

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    try {
        let cents = 0;
        for await (const session of api().beta.sessions.list({
            agent_id: agentId,
            "created_at[gte]": monthStart.toISOString(),
            include_archived: true,
        })) {
            cents += Number(session.usage.list_cost?.amount ?? 0);
        }
        return cents;
    } catch (err) {
        console.error("[chat] couldn't total this month's spend:", err);
        return null;
    }
}

/**
 * This mode's budget, cut to what's left of the monthly limit, or null if
 * less than MIN_SESSION_CENTS is left.
 */
export function sessionBudget(modeCents: number, monthCents: number, reserved: number): number | null {
    const left = MONTHLY_LIMIT_CENTS - monthCents - reserved;
    const budget = Math.min(modeCents, left);
    return budget >= MIN_SESSION_CENTS ? budget : null;
}
