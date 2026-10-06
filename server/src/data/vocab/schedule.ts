// The study plan of one screen in one book: new words in order (a textbook's) or shuffled,
// one per refresh or one per day, and reviews spaced on the forgetting curve.
//
// The screen has no buttons, so there is no "knew it / forgot it" to adapt to (as Anki or
// SuperMemo do); instead the fixed review intervals of Ebbinghaus-style plans: a word comes
// back 1, 2, 4, 7 and 15 days after it was new. The card shows the new word, the review
// line the words due today (taking turns when more are due than fit), or else the last ones.
// Pure functions on a small state, stored per screen ("study:<book>").
import { cycleIndex } from "../rotation.js";

export const REVIEW_DAYS = [1, 2, 4, 7, 15];
const KEEP_DAYS = 16;

export interface Progress {
  /** Position in the order of the words shown as new so far (-1: none yet). */
  next: number;
  /** Words shown as new: [index, day]. Only the last KEEP_DAYS days (and the last 3) kept. */
  log: [number, number][];
  /** Turns of the review line. */
  turn: number;
  /** Shuffles the order (per screen). */
  seed: number;
}

export interface Pick {
  /** Index of the new word. */
  current: number;
  reviews: { index: number; daysAgo: number }[];
  /** 1-based place of the new word in the book, and the round through it. */
  learned: number;
  round: number;
}

export const newProgress = (seed = Math.floor(Math.random() * 1e6)): Progress => ({ next: -1, log: [], turn: 0, seed });

/** Days since 1970 of the local date. */
export const dayNumber = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

/** The k-th word of the order: the book's own, or a shuffle (every word once per round). */
export function orderAt(k: number, n: number, ordered: boolean, seed: number): number {
  return ordered ? ((k % n) + n) % n : cycleIndex(k, n, seed % n);
}

export interface StepOptions {
  /** One new word per day (else one per refresh). */
  daily: boolean;
  /** A device refresh (previews do not move on). */
  advance: boolean;
  ordered: boolean;
  /** Review words on the card. */
  reviews: number;
}

/** Moves the plan on (when due) and picks the card. Returns the new state; `p` is not changed. */
export function step(p: Progress, n: number, today: number, o: StepOptions): { progress: Progress; pick: Pick } {
  const q: Progress = { ...p, log: [...p.log] };
  const lastDay = q.log.length ? q.log[q.log.length - 1][1] : -1;
  if (o.advance && (q.next < 0 || !o.daily || lastDay !== today)) {
    q.next++;
    q.log.push([orderAt(q.next, n, o.ordered, q.seed), today]);
  }
  if (o.advance) q.turn++;  // (every refresh: the review line moves on even when the new word does not)
  const current = orderAt(Math.max(0, q.next), n, o.ordered, q.seed);
  // keep what reviews still need, and the last few
  q.log = q.log.filter(([, day], i) => today - day <= KEEP_DAYS || i >= q.log.length - 3);

  // the latest showing of each other word, with its age
  const latest = new Map<number, number>();
  for (const [index, day] of q.log) if (index !== current) latest.set(index, day);
  const seen = [...latest].map(([index, day]) => ({ index, daysAgo: today - day }));
  const due = seen.filter((s) => REVIEW_DAYS.includes(s.daysAgo)).sort((a, b) => a.daysAgo - b.daysAgo || a.index - b.index);
  let reviews: Pick["reviews"];
  if (due.length > o.reviews) {
    // more due than fit: take turns, so every due word shows during the day
    const start = (q.turn * o.reviews) % due.length;
    reviews = Array.from({ length: o.reviews }, (_, k) => due[(start + k) % due.length]);
  } else {
    // the due ones, then the most recent others
    const recent = seen.filter((s) => !due.includes(s)).reverse();
    reviews = [...due, ...recent].slice(0, o.reviews);
  }
  const k = Math.max(0, q.next);
  return { progress: q, pick: { current, reviews, learned: (k % n) + 1, round: Math.floor(k / n) + 1 } };
}

/** The new word had nothing to show (no meaning anywhere): the next one instead. */
export function skipCurrent(p: Progress, n: number, today: number, ordered: boolean): Progress {
  const q: Progress = { ...p, log: [...p.log], next: p.next + 1 };
  const index = orderAt(q.next, n, ordered, q.seed);
  if (q.log.length && q.log[q.log.length - 1][1] === today) q.log[q.log.length - 1] = [index, today];
  else q.log.push([index, today]);
  return q;
}
