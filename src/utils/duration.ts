/**
 * Parses a duration string like "10m", "1h", "30s", "1d" into milliseconds.
 * Returns null if the input doesn't match. Supports s/m/h/d.
 */
export function parseDuration(input: string): number | null {
    const match = /^(\d+)\s*(s|m|h|d)$/i.exec(input.trim());
    if (!match) return null;

    const value = Number(match[1]);
    const unit = match[2]!.toLowerCase();

    const multipliers: Record<string, number> = {
        s: 1_000,
        m: 60_000,
        h: 3_600_000,
        d: 86_400_000,
    };

    return value * multipliers[unit]!;
}