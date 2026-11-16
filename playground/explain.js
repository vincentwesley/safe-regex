// Turns a pattern into plain-English "piece -> meaning" rows, using the library's own parser (no second tokenizer).
import { parse, parseFlags } from '../src/parser.ts';

const MAX_ROWS = 12;
const MAX_TEXT = 280;
const q = (s) => `“${s}”`;
const NAMED = { ' ': 'a space', '\n': 'a line break', '\t': 'a tab', '\r': 'a line break' };
const CLASS = {
  d: 'a digit from 0 to 9',
  D: 'anything except a digit',
  w: 'a letter, digit or underscore',
  W: 'anything except a letter, digit or underscore',
  s: 'a space, tab or line break',
  S: 'anything except spaces, tabs and line breaks',
};
const SHORT = { d: 'digits', D: 'non-digits', w: 'letters, digits or underscore', W: 'anything but letters, digits or underscore', s: 'spaces and line breaks', S: 'anything but spaces and line breaks' };
const CTRL = { n: '\n', t: '\t', r: '\r' };

function unescape(src) {
  let m;
  if ((m = /^\\u([0-9a-fA-F]{4})$/.exec(src))) return String.fromCharCode(parseInt(m[1], 16));
  if ((m = /^\\x([0-9a-fA-F]{2})$/.exec(src))) return String.fromCharCode(parseInt(m[1], 16));
  if ((m = /^\\([ntr])$/.exec(src))) return CTRL[m[1]];
  if ((m = /^\\([^a-zA-Z0-9])$/.exec(src))) return m[1];
  return src.length === 1 ? src : null;
}

function charName(ch) {
  if (NAMED[ch]) return NAMED[ch];
  const cp = ch.codePointAt(0);
  if (cp < 32 || cp === 127 || (cp >= 0x200b && cp <= 0x200f)) return `a hidden character (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`;
  return `the character ${q(ch)}`;
}

// A node that stands for one plain character, or null.
function literalOf(node, source) {
  if (node.type === 'char') return String.fromCodePoint(node.value);
  if (node.type === 'set') {
    const src = source.slice(node.span.start, node.span.end);
    if (/^[^\\.[\]]$/.test(src) || /^\\[^a-zA-Z0-9]$/.test(src)) return unescape(src);
  }
  return null;
}

const TOKEN = '(?:\\\\u[0-9a-fA-F]{4}|\\\\x[0-9a-fA-F]{2}|\\\\.|[^\\\\])';
const TOKENS = new RegExp(`${TOKEN}(?:-${TOKEN})?`, 'g');

function tokenName(t) {
  if (/^\\[dDwWsS]$/.test(t)) return SHORT[t[1]];
  const range = new RegExp(`^(${TOKEN})-(${TOKEN})$`).exec(t);
  const nm = (x) => { const c = unescape(x); if (c === null) return x; const cp = c.codePointAt(0); return cp < 32 || (cp >= 0x200b && cp <= 0x200f) ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : c; };
  if (range && t.length > 2) return `${q(nm(range[1]))} to ${q(nm(range[2]))}`;
  return q(nm(t));
}

function describeSet(src, flags) {
  if (src === '.') return flags.dotAll ? 'any character' : 'any single character except a line break';
  let m;
  if ((m = /^\\([dDwWsS])$/.exec(src))) return CLASS[m[1]];
  if (src[0] === '[' && src.at(-1) === ']') {
    const neg = src[1] === '^';
    const names = (src.slice(neg ? 2 : 1, -1).match(TOKENS) ?? []).map(tokenName);
    const shown = names.slice(0, 8);
    let list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} or ${shown.at(-1)}` : shown[0] ?? 'nothing';
    if (names.length > 8) list += ` and ${names.length - 8} more`;
    return neg ? `any character except ${list}` : `one character: ${list}`;
  }
  const ch = unescape(src);
  if (ch !== null) return charName(ch) + (flags.ignoreCase && /\p{L}/u.test(ch) ? ' (upper or lower case)' : '');
  return `a character matching ${q(src)}`;
}

function times(min, max) {
  if (min === 0 && max === Infinity) return 'zero or more times';
  if (min === 1 && max === Infinity) return 'one or more times';
  if (min === 0 && max === 1) return 'optional (zero or one time)';
  if (min === max) return min === 1 ? 'exactly once' : `exactly ${min} times`;
  if (max === Infinity) return `${min} or more times`;
  return `between ${min} and ${max} times`;
}

function hasLoop(node) {
  if (node.type === 'repeat' && node.max > 1) return true;
  if (node.type === 'group' || node.type === 'repeat') return hasLoop(node.body);
  if (node.type === 'alt') return node.alternatives.some(hasLoop);
  if (node.type === 'concat') return node.items.some(hasLoop);
  return false;
}

function describe(node, cx, depth = 0) {
  if (depth > 5) return 'more detail';
  const { source, flags } = cx;
  const src = source.slice(node.span.start, node.span.end);
  switch (node.type) {
    case 'empty': return 'nothing (an empty part)';
    case 'char': return charName(String.fromCodePoint(node.value));
    case 'set': return describeSet(src, flags);
    case 'assert':
      return { start: flags.multiline ? 'the start of a line' : 'the start of the text', end: flags.multiline ? 'the end of a line' : 'the end of the text', 'word-boundary': 'the edge of a word', 'not-word-boundary': 'a spot that is not the edge of a word' }[node.kind];
    case 'group': {
      const body = describe(node.body, cx, depth + 1);
      if (node.name) return `a group named ${q(node.name)} (${body})`;
      return node.index === null ? `a group that doesn't save its match (${body})` : `a group (${body})`;
    }
    case 'alt': return `either ${node.alternatives.map((a) => describe(a, cx, depth + 1)).join(' or ')}`;
    case 'concat': return chunks(node.items, cx, depth + 1).map((c) => c.text).join(', then ');
    case 'repeat': {
      let s = `${describe(node.body, cx, depth + 1)}, ${times(node.min, node.max)}`;
      if (!node.greedy) s += ', as few as possible';
      if (hasLoop(node.body) && node.max > 1) s += ' (a repeat inside another repeat)';
      return s;
    }
    default: return `a part matching ${q(src)}`;
  }
}

// Describes a list of nodes, merging runs of plain characters into one piece.
function chunks(nodes, cx, depth = 0) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const lit = literalOf(nodes[i], cx.source);
    if (lit !== null && /\S/.test(lit)) {
      let text = lit;
      let j = i + 1;
      while (j < nodes.length) {
        const l = literalOf(nodes[j], cx.source);
        if (l === null || !/\S/.test(l)) break;
        text += l;
        j++;
      }
      const last = nodes[j - 1];
      const ic = cx.flags.ignoreCase && /\p{L}/u.test(text) ? ' (upper or lower case)' : '';
      out.push({ start: nodes[i].span.start, end: last.span.end, text: j - i > 1 ? `the text ${q(text)}${ic}` : `${charName(text)}${ic}` });
      i = j - 1;
    } else {
      out.push({ start: nodes[i].span.start, end: nodes[i].span.end, text: describe(nodes[i], cx, depth) });
    }
  }
  return out;
}

const clip = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

/** @returns {{rows: {start:number,end:number,piece:string,text:string}[], more:number} | null} null when the pattern can't be parsed */
export function explain(pattern, flagStr) {
  let parsed;
  try {
    parsed = parse(pattern, parseFlags(flagStr, pattern));
  } catch {
    return null;
  }
  const cx = { source: pattern, flags: parsed.flags };
  const root = parsed.ast;
  let rows;
  if (root.type === 'alt') {
    rows = root.alternatives.map((a, i) => ({ start: a.span.start, end: a.span.end, text: `${i ? 'Or' : 'Either'}: ${describe(a, cx)}` }));
  } else {
    rows = chunks(root.type === 'concat' ? root.items : [root], cx);
  }
  const more = Math.max(0, rows.length - MAX_ROWS);
  return {
    rows: rows.slice(0, MAX_ROWS).map((r) => ({ ...r, piece: pattern.slice(r.start, r.end) || '(empty)', text: clip(r.text) })),
    more,
  };
}
