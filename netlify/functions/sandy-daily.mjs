// Sandy's morning check-in to Miranda (added Oct 21 2026), 9 AM Central every day.
// Netlify's schedule is in UTC, so it wakes at both 14:00 and 15:00 UTC and only goes ahead when it's
// 9 AM in Central time (works through daylight saving changes). Runs only on the live site.
import { env, hourCT, sandyKey } from "../sandy/brain.mjs";
const SEND_HOUR = 9;

export default async () => {
  if (hourCT() !== SEND_HOUR) return;
  const base = env("URL") || "https://mirandaraephotography.com";
  await fetch(base + "/.netlify/functions/sandy-reply-background", {
    method: "POST", headers: { "Content-Type": "application/json", "x-sandy-key": await sandyKey() },
    body: JSON.stringify({ kind: "daily", base }),
  });
};

export const config = { schedule: "0 14,15 * * *" };
