const CHARS_PER_SECOND = 18;
const BASE_MS = 50;
const MIN_MS = 50;

/** How long a human would take to type `length` characters, clamped to `maxMs`. */
export function typingDelay(length: number, maxMs: number): number {
    const raw = BASE_MS + (length / CHARS_PER_SECOND) * 1000;
    return Math.min(maxMs, Math.max(MIN_MS, Math.round(raw)));
}
