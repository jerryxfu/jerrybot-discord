/** Cuts `text` to `max` characters, marking the cut with "…". */
export function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
