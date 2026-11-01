const DISCORD_LIMIT = 2000;

/**
 * Splits text into chunks Discord will accept, preferring to break at a line,
 * then a space, and only cutting mid-word as a last resort.
 */
export function splitMessage(text: string, limit = DISCORD_LIMIT): string[] {
    const chunks: string[] = [];
    let rest = text.trim();

    while (rest.length > limit) {
        const window = rest.slice(0, limit);
        let cut = window.lastIndexOf("\n");
        if (cut < limit / 2) cut = window.lastIndexOf(" ");
        if (cut < limit / 2) cut = limit;

        chunks.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
    }

    if (rest) chunks.push(rest);
    return chunks;
}
