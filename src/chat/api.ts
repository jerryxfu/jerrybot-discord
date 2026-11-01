import Anthropic from "@anthropic-ai/sdk";

let anthropic: Anthropic | null = null;

/** The Anthropic client. Lazy, so the rest of the bot runs fine without an API key. */
export function api(): Anthropic {
    anthropic ??= new Anthropic();
    return anthropic;
}
