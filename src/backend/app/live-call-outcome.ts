/**
 * Turns a live hotel negotiation transcript into the rate, concession trail,
 * and summary shown on the result dashboard.
 */

export type LiveTranscriptLine = {
  role: "user" | "agent";
  message: string;
  timeInCallSecs: number;
};

export type LiveCallStep = {
  label: string;
  amountCents: number;
  time: string;
  impactCents: number | null;
};

type RateMention = {
  cents: number;
  timeInCallSecs: number;
  role: "user" | "agent";
  message: string;
  tentative: boolean;
};

const ONES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_PHRASE =
  /\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,5})(?:\.(\d{2}))?|\b((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s]+(?:one|two|three|four|five|six|seven|eight|nine))?|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|ten|[1-9][0-9]{0,4}(?:\.\d{2})?)\b/gi;

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function secondsToClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function toDigitCents(whole: string, fraction?: string): number | null {
  const dollars = Number(whole.replace(/,/g, ""));
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const cents = dollars * 100 + (fraction ? Number(fraction) : 0);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

function wordToDollars(phrase: string): number | null {
  const tokens = phrase
    .toLowerCase()
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((token) => token && token !== "and");
  if (tokens.length === 0) return null;
  let total = 0;
  for (const token of tokens) {
    if (token === "hundred" && total > 0) {
      total *= 100;
      continue;
    }
    if (TENS[token] !== undefined) {
      total += TENS[token];
      continue;
    }
    if (ONES[token] !== undefined) {
      total += ONES[token];
      continue;
    }
    return null;
  }
  return total > 0 ? total : null;
}

function phraseToCents(match: RegExpExecArray): number | null {
  if (match[1]) return toDigitCents(match[1], match[2]);
  const raw = match[3] ?? "";
  if (/^[0-9]/.test(raw)) {
    const [whole, fraction] = raw.split(".");
    return toDigitCents(whole, fraction);
  }
  const dollars = wordToDollars(raw);
  return dollars === null ? null : dollars * 100;
}

function normalizeSpeech(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/twen\s*-?\s*/g, "")
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isProgressiveRepeat(previous: string, next: string): boolean {
  const left = normalizeSpeech(previous);
  const right = normalizeSpeech(next);
  if (!left || !right) return false;
  if (left === right) return true;
  return right.startsWith(left) || left.startsWith(right) || right.includes(left);
}

/** Drops STT partials so "I think" / "I think I can lower it by twenty" become one line. */
export function collapseTranscript<T extends { role: string; message: string }>(lines: readonly T[]): T[] {
  const collapsed: T[] = [];
  for (const line of lines) {
    const message = line.message.trim();
    if (!message) continue;
    const last = collapsed[collapsed.length - 1];
    if (last && last.role === line.role && isProgressiveRepeat(last.message, message)) {
      if (message.length >= last.message.length) last.message = message;
      continue;
    }
    collapsed.push({ ...line, message });
  }
  return collapsed;
}

function isPlausibleNightly(cents: number, originalCents: number): boolean {
  const floor = Math.max(1_000, Math.round(originalCents * 0.2));
  const ceiling = Math.round(originalCents * 1.4);
  return cents >= floor && cents <= ceiling;
}

function isPlausibleDiscount(cents: number, originalCents: number): boolean {
  return cents >= 500 && cents < originalCents && cents <= Math.round(originalCents * 0.6);
}

function isTentative(text: string): boolean {
  return /\?|\b(?:can you|could you|perhaps|what about|how about|if you)\b/i.test(text);
}

function windowBefore(text: string, index: number): string {
  return text.slice(Math.max(0, index - 48), index).toLowerCase();
}

function windowAfter(text: string, index: number, length: number): string {
  return text.slice(index, index + length + 32).toLowerCase();
}

function extractMentionsFromLine(
  line: LiveTranscriptLine,
  originalCents: number,
): RateMention[] {
  const mentions: RateMention[] = [];
  const text = line.message;
  NUMBER_PHRASE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMBER_PHRASE.exec(text)) !== null) {
    const amount = phraseToCents(match);
    if (amount === null) continue;
    const before = windowBefore(text, match.index);
    const after = windowAfter(text, match.index, match[0].length);
    const nearby = `${before} ${after}`;
    const moneyCue = /\$|dollar|buck|night|nightly|rate|price|offer/.test(nearby);
    const relationCue = /\b(?:by|to|at|than|do)\s*$/.test(before.trim()) || /\b(?:by|to|at|than)\b/.test(before.slice(-12));

    if (/\b(?:lower|reduc(?:e|ing)|drop|cut|off|minus|discount)\b/.test(before) && /\bby\b/.test(before)) {
      if (!isPlausibleDiscount(amount, originalCents)) continue;
      const next = originalCents - amount;
      if (!isPlausibleNightly(next, originalCents)) continue;
      mentions.push({
        cents: next,
        timeInCallSecs: line.timeInCallSecs,
        role: line.role,
        message: line.message,
        tentative: isTentative(text),
      });
      continue;
    }

    if (/\blower than\b/.test(before)) {
      if (isPlausibleNightly(amount, originalCents)) {
        mentions.push({
          cents: amount,
          timeInCallSecs: line.timeInCallSecs,
          role: line.role,
          message: line.message,
          tentative: isTentative(text),
        });
        continue;
      }
      if (isPlausibleDiscount(amount, originalCents)) {
        const next = originalCents - amount;
        if (isPlausibleNightly(next, originalCents)) {
          mentions.push({
            cents: next,
            timeInCallSecs: line.timeInCallSecs,
            role: line.role,
            message: line.message,
            tentative: isTentative(text),
          });
        }
      }
      continue;
    }

    if (!moneyCue && !relationCue) continue;
    if (!isPlausibleNightly(amount, originalCents)) continue;
    mentions.push({
      cents: amount,
      timeInCallSecs: line.timeInCallSecs,
      role: line.role,
      message: line.message,
      tentative: isTentative(text),
    });
  }
  return mentions;
}

function pickFinalCents(
  originalCents: number,
  recordedFinalCents: number | null | undefined,
  mentions: readonly RateMention[],
): number {
  if (
    typeof recordedFinalCents === "number" &&
    Number.isFinite(recordedFinalCents) &&
    isPlausibleNightly(recordedFinalCents, originalCents)
  ) {
    return recordedFinalCents;
  }

  const firm = mentions.filter((mention) => !mention.tentative);
  const pool = firm.length > 0 ? firm : mentions;
  if (pool.length === 0) return originalCents;

  const confirmed = [...pool].reverse().find((mention) =>
    /\b(lock|locked|confirm|confirmed|final|agree|agreed|take that|take it|we'll take|all set|approved|lowest|best we can)\b/i.test(
      mention.message,
    ),
  );
  if (confirmed) return confirmed.cents;

  const hotelOffer = [...pool].reverse().find((mention) => mention.role === "user");
  if (hotelOffer) return hotelOffer.cents;
  return pool[pool.length - 1]?.cents ?? originalCents;
}

function labelForMention(mention: RateMention, originalCents: number, finalCents: number): string {
  if (mention.cents === finalCents && mention.cents !== originalCents) return "Agreed nightly rate";
  if (mention.cents === originalCents) return "Opening group rate restated";
  return mention.role === "user" ? "Hotel offer" : "Rate discussed";
}

export function buildLiveSteps(
  originalCents: number,
  finalCents: number,
  mentions: readonly RateMention[],
): LiveCallStep[] {
  const steps: LiveCallStep[] = [
    { label: "Opening group rate", amountCents: originalCents, time: "00:00", impactCents: null },
  ];

  const seen = new Set<number>([originalCents, finalCents]);
  let previous = originalCents;
  for (const mention of mentions) {
    if (seen.has(mention.cents) || mention.tentative) continue;
    if (mention.cents >= originalCents) continue;
    seen.add(mention.cents);
    steps.push({
      label: labelForMention(mention, originalCents, finalCents),
      amountCents: mention.cents,
      time: secondsToClock(mention.timeInCallSecs),
      impactCents: mention.cents - previous,
    });
    previous = mention.cents;
    if (steps.length >= 4) break;
  }

  const lastTime = mentions[mentions.length - 1]?.timeInCallSecs ?? 0;
  steps.push({
    label: finalCents < originalCents ? "Agreed nightly rate" : "Rate unchanged",
    amountCents: finalCents,
    time: lastTime > 0 ? secondsToClock(lastTime) : "on call",
    impactCents: finalCents - previous,
  });
  return steps;
}

export function buildLiveCallSummary(input: {
  providerName: string;
  originalCents: number;
  finalCents: number;
  targetMet: boolean;
  turnCount: number;
}): string {
  const hotel = input.providerName.trim() || "The hotel";
  if (input.finalCents < input.originalCents) {
    const saved = input.originalCents - input.finalCents;
    const pct = input.originalCents > 0 ? Math.round((saved / input.originalCents) * 1000) / 10 : 0;
    return `${hotel} confirmed ${money(input.finalCents)} per room / night, down from ${money(input.originalCents)} (${pct}% lower). Stay details are unchanged.${input.targetMet ? " Private target met." : ""}`;
  }
  return `${hotel} did not change the ${money(input.originalCents)} nightly group rate after the call.`;
}

export function parseNightlyAmountsCents(text: string): number[] {
  const amounts: number[] = [];
  NUMBER_PHRASE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMBER_PHRASE.exec(String(text ?? ""))) !== null) {
    const cents = phraseToCents(match);
    if (cents !== null && !amounts.includes(cents)) amounts.push(cents);
  }
  return amounts;
}

export function deriveLiveCallOutcome(input: {
  originalCents: number;
  targetCents: number;
  transcript: readonly LiveTranscriptLine[];
  recordedFinalCents?: number | null;
  providerName: string;
}): {
  finalCents: number;
  steps: LiveCallStep[];
  targetMet: boolean;
  summary: string;
  transcript: LiveTranscriptLine[];
} {
  const transcript = collapseTranscript(input.transcript);
  const mentions = transcript.flatMap((line) => extractMentionsFromLine(line, input.originalCents));
  const finalCents = pickFinalCents(input.originalCents, input.recordedFinalCents, mentions);
  const targetMet = finalCents <= input.targetCents;
  return {
    finalCents,
    steps: buildLiveSteps(input.originalCents, finalCents, mentions),
    targetMet,
    transcript,
    summary: buildLiveCallSummary({
      providerName: input.providerName,
      originalCents: input.originalCents,
      finalCents,
      targetMet,
      turnCount: transcript.length,
    }),
  };
}
