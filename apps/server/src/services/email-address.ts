/**
 * Pulls the bare address out of a raw "From" header like `"Jane Doe" <jane@x.com>` or a bare
 * `jane@x.com`. Used to detect "sent by the user" across a thread's messages (VIP/unanswered
 * heuristic) and to group senders by address rather than by display-name casing (sender-frequency
 * dashboard tile) — both need a stable, comparable key rather than the raw header string.
 */
export function extractEmailAddress(header: string | null): string | null {
  if (!header) return null;
  const angleMatch = header.match(/<([^>]+)>/);
  const candidate = (angleMatch?.[1] ?? header).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/**
 * Pulls the display name out of a raw "From" header like `"Jane Doe" <jane@x.com>`, or `null` if
 * there is no name part (a bare address) — the sender-frequency dashboard tile prefers a human
 * name when one exists, falling back to the bare address otherwise.
 */
export function extractDisplayName(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  const name = match?.[1]?.trim();
  return name ? name : null;
}
