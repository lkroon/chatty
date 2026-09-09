import type { BriefingItems, BriefingSection } from '@contracts';

/**
 * Versioned on purpose: the shape below is written to a user's disk, and a
 * later change to `BriefingItems` must not be handed stale data it cannot
 * read. Bump the suffix whenever `CachedBriefing` changes.
 */
export const BRIEFING_CACHE_KEY = 'chatty.briefing.v1';

/**
 * A cache this old is not worth showing even for the instant before the
 * revalidation lands — the agenda in it is from another day's morning.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CachedBriefing {
  items: BriefingItems;
  /** The model-written summary that went with `summaryFingerprint`. */
  summary: string;
  /** `itemFingerprint(items)` as it was when `summary` was generated. */
  summaryFingerprint: string;
  /**
   * Tasks the user dismissed from Today. Google Tasks has no "discard", and
   * deleting has no undo on their side, so a dismissal is local only.
   */
  dismissedTaskIds: string[];
  cachedAt: number;
}

/**
 * The last good briefing, or null when there is nothing usable.
 *
 * This is the only mail data the app puts on disk. Anything that ends the
 * session — a logout, a 401, disconnecting Google — must call
 * `clearBriefingCache()`.
 */
export function readBriefingCache(todayIso: string, now = Date.now()): CachedBriefing | null {
  const raw = readLocalStorage(BRIEFING_CACHE_KEY);
  if (!raw) {
    return null;
  }
  let parsed: CachedBriefing;
  try {
    parsed = JSON.parse(raw) as CachedBriefing;
  } catch {
    return null;
  }
  if (!parsed?.items?.date || typeof parsed.cachedAt !== 'number') {
    return null;
  }
  if (parsed.items.date !== todayIso) {
    return null;
  }
  if (now - parsed.cachedAt > MAX_AGE_MS) {
    return null;
  }
  return { ...parsed, dismissedTaskIds: parsed.dismissedTaskIds ?? [] };
}

export function writeBriefingCache(value: CachedBriefing): void {
  writeLocalStorage(BRIEFING_CACHE_KEY, JSON.stringify(value));
}

export function clearBriefingCache(): void {
  removeLocalStorage(BRIEFING_CACHE_KEY);
}

/**
 * A stable string over the item set, used to decide whether a manual refresh
 * needs to pay for a new summary.
 *
 * Deliberately excludes `generatedAt` (changes on every call) and the summary
 * itself (model output, which differs run to run on identical input). Sorted,
 * so a reordering upstream is not a change.
 */
export function itemFingerprint(items: BriefingItems): string {
  const parts = [
    `d:${items.date}`,
    section(items.calendar, (e) => `e:${e.id}:${e.start ?? 'allday'}`),
    section(items.tasks, (t) => `t:${t.id}:${t.due}`),
    section(items.mail, (m) => `m:${m.id}`),
    [...items.pending.map((p) => `p:${p.id}:${p.status}`)].sort().join(','),
    `x:${items.mailHasMore ? 1 : 0}`,
  ];
  return parts.join('|');
}

function section<T>(part: BriefingSection<T>, key: (item: T) => string): string {
  if (part.status !== 'ok') {
    return part.status;
  }
  return part.items.map(key).sort().join(',');
}

// Same guards as core/chat-store.ts: localStorage throws outright in some
// iOS and private-mode contexts, and a cache is never worth a crash.
function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the app just refetches every time.
  }
}

function removeLocalStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing was written either.
  }
}
