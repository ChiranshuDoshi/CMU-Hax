/**
 * Detects when the live negotiator has actually wrapped the call.
 * Used to hang up after the closing line, not mid-ask.
 */

const OPENING = /^hi[,.]?\s+i(?:'m| am) atrium\b/i;
const QUESTION = /\?/;
const STILL_ASKING =
  /\b(?:if you can|can you|could you|would you|what (?:can|about)|how (?:much|low)|any (?:room|flexibility))\b/i;

const FAREWELL =
  /\b(?:have a (?:good|great|nice|wonderful) (?:day|evening|night|one)|good-?bye|talk soon|thanks for your time|thank you for your time|i(?:'ll| will) let you (?:go|get back)|we(?:'ll| will) (?:be in touch|follow up)|appreciate your time|take care)\b/i;

const WRAP =
  /\b(?:i(?:'ll| will) lock|locked in|i(?:'ll| will) take (?:that|it|this|the|\$|\d)|we(?:'ll| will) take (?:that|it|this|the|\$|\d)|we(?:'ll| will) confirm|we(?:'re| are) (?:all )?set|that(?:'s| is) all (?:we|i) need|consider it done|i(?:'ll| will) note that|confirmed at|final (?:nightly )?rate|no change|leave (?:the rate|it) (?:as|at)|keep the current|unable to (?:move|go lower)|that(?:'s| is) (?:our|my) final)\b/i;

const THANKS_CLOSE = /(?:thank you|thanks)[.!]*\s*$/i;

export function looksLikeNegotiationClose(text) {
  const line = String(text ?? "").trim();
  if (!line || OPENING.test(line) || QUESTION.test(line) || STILL_ASKING.test(line)) {
    return false;
  }
  return FAREWELL.test(line) || WRAP.test(line) || THANKS_CLOSE.test(line);
}

export function shouldAutoEndCall({ userTurns, lastAgentText }) {
  return Number(userTurns) >= 2 && looksLikeNegotiationClose(lastAgentText);
}
