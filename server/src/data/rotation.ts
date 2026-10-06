// "A new one on every refresh": a per-screen counter ("counter:<layout>", advanced by
// real device requests, not by previews) walked through a pseudo-random permutation, so
// every item shows once before any repeats.
import { type Db, getSetting, setSetting } from "../db.js";

const STEPS = [7919, 104729, 1299709, 15485863, 32452843];
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Item number `c` of a fixed shuffled order of 0..n-1 (c may be any integer). */
export function cycleIndex(c: number, n: number, salt = 0): number {
  if (n <= 1) return 0;
  const step = STEPS.find((p) => gcd(p % n, n) === 1 && p % n !== 1) ?? 1;
  return ((((c % n) + n) % n) * (step % n) + salt) % n;
}

/** The screen's counter for `layout`, moved on by one when `advance` (a device refresh). */
export function counter(db: Db, layout: string, advance: boolean): number {
  const key = `counter:${layout}`;
  let n = Number(getSetting(db, key, "0")) || 0;
  if (advance) setSetting(db, key, String(++n));
  return n;
}
