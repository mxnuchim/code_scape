/**
 * Secret redaction for any source text CodeScape shows or returns: private
 * keys, common token formats, and `password = "…"`-style assignments.
 * Pure, so it runs in Node and the browser.
 */
const REDACTIONS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bsk-(ant-)?[A-Za-z0-9_-]{24,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];
const ASSIGNMENT = /((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|token|client[_-]?secret)["']?\s*[:=]\s*["'])([^"'\s]{8,})(["'])/gi;

export const REDACTED = "[REDACTED]";

export function redactSecrets(text: string): { text: string; redactions: number } {
  let count = 0;
  let out = text;
  for (const re of REDACTIONS) {
    out = out.replace(re, () => {
      count++;
      return REDACTED;
    });
  }
  out = out.replace(ASSIGNMENT, (match, pre: string, value: string, post: string) => {
    if (value === REDACTED) return match;
    count++;
    return `${pre}${REDACTED}${post}`;
  });
  return { text: out, redactions: count };
}
