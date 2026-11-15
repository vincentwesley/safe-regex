import { SafeRegexLimitError, SafeRegexSyntaxError, SafeRegexUnsupportedError, type UnsupportedFeature } from './errors.js';
import { SafeRegExp } from './regexp.js';

export type SupportResult =
  | { ok: true }
  | { ok: false; kind: 'syntax'; message: string; offset: number }
  | { ok: false; kind: 'unsupported'; feature: UnsupportedFeature; message: string; offset: number }
  | { ok: false; kind: 'limit'; message: string };

/** Reports whether SafeRegExp accepts a pattern, and if not, why — without throwing. */
export function checkSupport(pattern: string, flags = ''): SupportResult {
  try {
    new SafeRegExp(pattern, flags);
    return { ok: true };
  } catch (e) {
    if (e instanceof SafeRegexUnsupportedError) {
      return { ok: false, kind: 'unsupported', feature: e.feature, message: e.message, offset: e.offset };
    }
    if (e instanceof SafeRegexSyntaxError) return { ok: false, kind: 'syntax', message: e.message, offset: e.offset };
    if (e instanceof SafeRegexLimitError) return { ok: false, kind: 'limit', message: e.message };
    throw e;
  }
}
