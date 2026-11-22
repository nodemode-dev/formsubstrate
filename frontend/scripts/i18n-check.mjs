import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(FRONT, 'src');
const I18N = join(SRC, 'ui', 'i18n');
const I18N_TS = join(SRC, 'ui', 'i18n.ts');
const PARTS = ['', 'more', 'extra'];
const PLURAL = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>', '&&', '||', '??', '===', '!==', '==', '!=', '<=', '>=', '+=', '-=', '?.', '...', '${']);
const PUNCT = ['===', '!==', '...', '**=', '??=', '&&=', '||=', '>>>', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '&=', '|=', '^='];
const GLOBAL_PROPS = new Set(['label', 'title', 'hint', 'help', 'tip', 'description', 'sub', 'note', 'placeholder', 'empty']);
const CMP = new Set(['===', '!==', '==', '!=']);
const ITER = new Set(['map', 'forEach', 'filter', 'flatMap', 'some', 'every', 'find', 'findIndex']);
const COMMON_METHODS = new Set(['set', 'get', 'add', 'has', 'delete', 'push', 'open', 'show', 'hide', 'close', 'update', 'render', 'fill', 'select', 'request', 'emit', 'send', 'on', 'off', 'run', 'start', 'stop', 'load', 'save', 'write', 'read', 'reveal', 'focus', 'paint', 'replace', 'join', 'split', 'call', 'then', 'catch', 'toggle', 'remove', 'insert', 'append', 'post', 'put', 'fetch', 'refresh', 'list']);
const MODIFIERS = new Set(['private', 'public', 'protected', 'static', 'readonly', 'async', 'override', 'abstract', 'declare']);
const SKIP_CALLS = new Set(['startsWith', 'endsWith', 'includes', 'split', 'join', 'replace', 'replaceAll', 'getElementById', 'querySelector', 'querySelectorAll', 'closest', 'matches', 'q', 'qa', 'getAttribute', 'setAttribute', 'toggleAttribute', 'hasAttribute', 'removeAttribute', 'addEventListener', 'removeEventListener', 'createElement', 'add', 'remove', 'toggle', 'contains', 'dispatchEvent', 'Event', 'CustomEvent', 'icon', 'indexOf', 'lastIndexOf', 'padStart', 'padEnd', 'localeCompare', 'test', 'exec', 'match', 'RegExp', 'Error', 'get', 'has', 'delete', 'emit', 'on', 'request', 'invoke', 'setProperty', 'getPropertyValue', 'api', 'json', 'apiJson', 'post', 'put', 'fetch', 'getItem', 'setItem', 'removeItem', 'trim', 'slice', 'cmd', 'run']);

export function lex(src) {
  const toks = [];
  let i = 0;
  const braces = [];
  const last = () => toks[toks.length - 1];
  const regexOk = () => { const p = last(); if (!p) return true; if (p.type === 'punct') return REGEX_PREV.has(p.v); if (p.type === 'ident') return KEYWORDS.has(p.v); return false; };
  const readTpl = (from) => {
    const quasis = [];
    let j = from, v = '';
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') { v += unescape(src, j); j += escLen(src, j); continue; }
      if (src[j] === '$' && src[j + 1] === '{') { quasis.push(v); return { quasis, end: j, open: true }; }
      v += src[j++];
    }
    quasis.push(v);
    return { quasis, end: j, open: false };
  };
  const tplStack = [];
  while (i < src.length) {
    const c = src[i];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, v = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { v += unescape(src, j); j += escLen(src, j); continue; }
        v += src[j++];
      }
      toks.push({ type: 'str', v, pos: i });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      const r = readTpl(i + 1);
      const tok = { type: 'tpl', quasis: r.quasis, pos: i, v: r.open ? null : r.quasis[0] };
      toks.push(tok);
      if (r.open) { tplStack.push(tok); braces.push('tpl'); toks.push({ type: 'punct', v: '${', pos: r.end }); i = r.end + 2; }
      else i = r.end + 1;
      continue;
    }
    if (c === '}' && braces[braces.length - 1] === 'tpl') {
      braces.pop();
      toks.push({ type: 'punct', v: '$}', pos: i });
      const tok = tplStack[tplStack.length - 1];
      const r = readTpl(i + 1);
      tok.quasis.push(...r.quasis);
      if (r.open) { braces.push('tpl'); toks.push({ type: 'punct', v: '${', pos: r.end }); i = r.end + 2; }
      else { tplStack.pop(); i = r.end + 1; }
      continue;
    }
    if (c === '/' && regexOk()) {
      let j = i + 1, cls = false;
      while (j < src.length && (cls || src[j] !== '/') && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
        j++;
      }
      j++;
      while (/[a-z]/.test(src[j] ?? '')) j++;
      toks.push({ type: 'regex', v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      toks.push({ type: 'ident', v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < src.length && /[0-9A-Za-z_.]/.test(src[j])) j++;
      toks.push({ type: 'num', v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (c === '{') braces.push('{');
    if (c === '}') braces.pop();
    const p = PUNCT.find((x) => src.startsWith(x, i));
    if (p && !(p === '?.' && /[0-9]/.test(src[i + 2] ?? ''))) { toks.push({ type: 'punct', v: p, pos: i }); i += p.length; continue; }
    toks.push({ type: 'punct', v: c, pos: i });
    i++;
  }
  const st = [];
  toks.forEach((k, n) => {
    k.i = n;
    const v = k.type === 'punct' ? k.v : '';
    if (v === '(' || v === '[' || v === '{' || v === '${') st.push(k);
    else if (v === ')' || v === ']' || v === '}' || v === '$}') { const o = st.pop(); if (o) { o.mt = k; k.mt = o; } }
  });
  return toks;
}

function escLen(s, j) {
  const n = s[j + 1];
  if (n === 'u') return s[j + 2] === '{' ? s.indexOf('}', j) - j + 1 : 6;
  if (n === 'x') return 4;
  if (n === '\r' && s[j + 2] === '\n') return 3;
  return 2;
}

function unescape(s, j) {
  const n = s[j + 1];
  if (n === 'n') return '\n';
  if (n === 't') return '\t';
  if (n === 'r') return '\r';
  if (n === '0') return '\0';
  if (n === '\n' || n === '\r') return '';
  if (n === 'u') { const hex = s[j + 2] === '{' ? s.slice(j + 3, s.indexOf('}', j)) : s.slice(j + 2, j + 6); return String.fromCodePoint(parseInt(hex, 16)); }
  if (n === 'x') return String.fromCharCode(parseInt(s.slice(j + 2, j + 4), 16));
  return n;
}

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (p !== I18N) walkFiles(p, out); }
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && p !== I18N_TS) out.push(p);
  }
  return out.sort();
}

const isStr = (k) => !!k && (k.type === 'str' || (k.type === 'tpl' && k.v !== null));
const pv = (k) => (k && k.type === 'punct' ? k.v : '');
const OPEN = { '(': ')', '[': ']', '{': '}', '${': '$}' };
const SHUT = new Set([')', ']', '}', '$}']);

function close(toks, i) {
  const k = toks[i];
  if (k && k.mt && k.i !== undefined) { const j = i + (k.mt.i - k.i); if (toks[j] === k.mt) return j; }
  let d = 0;
  for (let j = i; j < toks.length; j++) {
    const v = pv(toks[j]);
    if (v in OPEN) d++;
    else if (SHUT.has(v)) { d--; if (d === 0) return j; }
  }
  return toks.length - 1;
}

function open(toks, i) {
  const k = toks[i];
  if (k && k.mt && k.i !== undefined) { const j = i + (k.mt.i - k.i); if (j >= 0 && toks[j] === k.mt) return j; }
  let d = 0;
  for (let j = i; j >= 0; j--) {
    const v = pv(toks[j]);
    if (SHUT.has(v)) d++;
    else if (v in OPEN) { d--; if (d === 0) return j; }
  }
  return 0;
}

function splitArgs(toks, a, b) {
  const args = [];
  let d = 0, s = a;
  for (let j = a; j < b; j++) {
    const v = pv(toks[j]);
    if (v in OPEN) d++;
    else if (SHUT.has(v)) d--;
    else if (v === ',' && d === 0) { args.push(toks.slice(s, j)); s = j + 1; }
  }
  if (s < b) args.push(toks.slice(s, b));
  return args;
}

function exprEnd(toks, j) {
  let d = 0;
  for (let e = j; e < toks.length; e++) {
    const v = pv(toks[e]);
    if (v in OPEN) d++;
    else if (SHUT.has(v)) { if (d === 0) return e; d--; }
    else if (d === 0 && (v === ';' || v === ',')) return e;
  }
  return toks.length;
}

function values(expr) {
  const out = [], refs = [], props = [], calls = [];
  let dyn = false;
  const stack = [];
  for (let j = 0; j < expr.length; j++) {
    const k = expr[j], prev = expr[j - 1], next = expr[j + 1];
    const v = pv(k);
    if (v in OPEN) {
      const isCall = v === '(' && prev && (prev.type === 'ident' || pv(prev) === ')' || pv(prev) === ']') && !KEYWORDS.has(prev.v);
      const isIndex = v === '[' && prev && (prev.type === 'ident' || pv(prev) === ')' || pv(prev) === ']' || pv(prev) === '?.') && !KEYWORDS.has(prev.v);
      stack.push(v === '${' ? 'tpl' : isCall ? (SKIP_CALLS.has(prev.v) ? 'skip' : 'call') : isIndex ? 'idx' : v);
      continue;
    }
    if (SHUT.has(v)) { stack.pop(); continue; }
    if (stack.includes('tpl') || stack.includes('skip') || stack.includes('call') || stack.includes('idx')) {
      continue;
    }
    const nest = stack.filter((s) => s === '{' || s === '[').length;
    if (isStr(k)) {
      if (nest > 1) continue;
      if (CMP.has(pv(prev)) || CMP.has(pv(next))) continue;
      if (pv(prev) === '[' && pv(next) === ']') continue;
      if ((pv(prev) === '{' || pv(prev) === ',') && pv(next) === ':') continue;
      if (pv(next) === '.' || pv(next) === '?.') continue;
      if (pv(prev) === 'in' || (prev && prev.type === 'ident' && prev.v === 'in')) continue;
      out.push(k.v);
      continue;
    }
    if (k.type === 'tpl') { dyn = true; continue; }
    if (k.type === 'ident') {
      if (pv(prev) === '.' || pv(prev) === '?.') {
        if (pv(next) === '(') { if (!COMMON_METHODS.has(k.v) && !SKIP_CALLS.has(k.v)) calls.push(k.v); }
        else if (pv(next) !== '.' && pv(next) !== '?.') props.push({ name: k.v, onThis: expr[j - 2]?.v === 'this' });
        continue;
      }
      if (pv(next) === '(') { calls.push(k.v); continue; }
      if ((pv(next) === '.' || pv(next) === '?.') && expr[j + 2]?.type === 'ident') continue;
      if (pv(prev) === '!') continue;
      if (pv(next) === ':' && (pv(prev) === '{' || pv(prev) === ',')) continue;
      if (pv(prev) === ':' && nest === 0 && stack.length === 0) continue;
      if (['this', 'true', 'false', 'null', 'undefined', 'as', 'const', 'typeof', 'keyof', 'satisfies', 'string', 'number', 'boolean'].includes(k.v)) continue;
      if (nest > 1) continue;
      refs.push({ name: k.v, at: k.i, indexed: pv(next) === '[' || (pv(next) === '?.' && pv(expr[j + 2]) === '[') });
    }
  }
  return { out, refs, props, calls, dyn };
}

function lineOf(f, pos) {
  if (!f.lines) { f.lines = [0]; for (let i = 0; i < f.text.length; i++) if (f.text.charCodeAt(i) === 10) f.lines.push(i + 1); }
  let lo = 0, hi = f.lines.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f.lines[m] <= pos) lo = m; else hi = m - 1; }
  return lo + 1;
}

function declarations(f, name) {
  const ts = f.toks, out = [];
  for (let i = 0; i < ts.length; i++) {
    const k = ts[i];
    if (k.type !== 'ident' || k.v !== name) continue;
    const p = ts[i - 1];
    const decl = p && p.type === 'ident' && (['const', 'let', 'var'].includes(p.v) || MODIFIERS.has(p.v));
    const field = p && (pv(p) === ';' || pv(p) === '{' || pv(p) === '}') && f.classBodies.some(([a, b]) => i > a && i < b && depthIn(ts, a, i) === 1);
    const bare = p && pv(p) !== '.' && pv(p) !== '?.' && !decl && !field && ts[i + 1]?.v === '=' && pv(ts[i + 1]) === '=';
    if (!decl && !field && !bare) continue;
    let j = i + 1;
    if (pv(ts[j]) === '?' || pv(ts[j]) === '!') j++;
    if (pv(ts[j]) === ':') {
      let d = 0;
      for (j = j + 1; j < ts.length; j++) {
        const v = pv(ts[j]);
        if (v === '<' || v in OPEN) d++;
        else if (v === '>' || SHUT.has(v)) d--;
        else if (d === 0 && (v === '=' || v === ';' || v === ',')) break;
      }
    }
    if (pv(ts[j]) !== '=') continue;
    j++;
    out.push({ at: j, expr: ts.slice(j, exprEnd(ts, j)) });
  }
  return out;
}

function depthIn(ts, a, i) {
  let d = 0;
  for (let j = a; j < i; j++) { const v = pv(ts[j]); if (v in OPEN) d++; else if (SHUT.has(v)) d--; }
  return d;
}

function classBodies(ts) {
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].type !== 'ident' || ts[i].v !== 'class') continue;
    let j = i + 1;
    while (j < ts.length && pv(ts[j]) !== '{') j++;
    out.push([j, close(ts, j), ts[i + 1]?.type === 'ident' ? ts[i + 1].v : '', ts[i + 2]?.v === 'extends' ? ts[i + 3]?.v : '']);
  }
  return out;
}

function functionBodies(f, name) {
  const ts = f.toks, out = [];
  for (let i = 0; i < ts.length; i++) {
    const k = ts[i];
    if (k.type !== 'ident' || k.v !== name) continue;
    const p = ts[i - 1];
    let j = i + 1;
    let isFn = (p && p.v === 'function') || (pv(ts[j]) === '(' && p && (pv(p) === '}' || pv(p) === ';' || pv(p) === '{' || MODIFIERS.has(p.v) || p.v === 'export'));
    if (!isFn && pv(ts[j]) === '=') {
      let a = j + 1;
      if (ts[a]?.v === 'async') a++;
      if (pv(ts[a]) === '(') { const e = close(ts, a); let b = e + 1; if (pv(ts[b]) === ':') while (b < ts.length && pv(ts[b]) !== '=>') b++; if (pv(ts[b]) === '=>') { isFn = true; j = a; } }
    }
    if (!isFn) continue;
    if (pv(ts[j]) === '<') { let d = 0; for (; j < ts.length; j++) { if (pv(ts[j]) === '<') d++; else if (pv(ts[j]) === '>') { d--; if (d === 0) { j++; break; } } } }
    if (pv(ts[j]) !== '(') continue;
    j = close(ts, j) + 1;
    if (pv(ts[j]) === ':') { j++; while (j < ts.length && pv(ts[j]) !== '{' && pv(ts[j]) !== '=>' && pv(ts[j]) !== ';') { if (pv(ts[j]) in OPEN) j = close(ts, j); j++; } }
    if (pv(ts[j]) === '=>') {
      if (pv(ts[j + 1]) === '{') out.push({ a: j + 1, b: close(ts, j + 1) });
      else out.push({ expr: ts.slice(j + 1, exprEnd(ts, j + 1)), at: j + 1 });
      continue;
    }
    if (pv(ts[j]) === '{') out.push({ a: j, b: close(ts, j) });
  }
  return out;
}

function returnsOf(f, name) {
  const out = [];
  for (const body of functionBodies(f, name)) {
    if (body.expr) { out.push(body); continue; }
    for (let r = body.a; r < body.b; r++) {
      if (f.toks[r].type === 'ident' && f.toks[r].v === 'return') out.push({ at: r + 1, expr: f.toks.slice(r + 1, Math.min(exprEnd(f.toks, r + 1), body.b)) });
    }
  }
  return out;
}

function paramNames(toks, a, b) {
  return splitArgs(toks, a, b).map((arg) => {
    let s = 0;
    while (arg[s] && MODIFIERS.has(arg[s].v)) s++;
    if (pv(arg[s]) === '[' || pv(arg[s]) === '{') {
      const e = close(arg, s);
      const names = [];
      let d = 0;
      for (let j = s + 1; j < e; j++) { const v = pv(arg[j]); if (v in OPEN) d++; else if (SHUT.has(v)) d--; else if (d === 0 && arg[j].type === 'ident' && pv(arg[j - 1]) !== ':' && pv(arg[j + 1]) !== ':') names.push(arg[j].v); else if (d === 0 && pv(arg[j]) === ',' && pv(arg[j - 1]) === ',') names.push(''); else if (d === 0 && arg[j].type === 'ident' && pv(arg[j + 1]) === ':') names.push(arg[j + 2]?.v ?? ''); }
      return { kind: pv(arg[s]), names };
    }
    return { kind: 'id', names: [arg[s]?.v ?? ''] };
  });
}

function enclosing(f, at, name) {
  const toks = f.toks;
  for (let i = at; i >= 0; i--) {
    if (pv(toks[i]) !== '(') continue;
    const e = close(toks, i);
    if (e >= at) continue;
    const params = paramNames(toks, i + 1, e);
    const idx = params.findIndex((p) => p.names.includes(name));
    if (idx < 0) continue;
    const sub = params[idx].kind === 'id' ? null : params[idx].names.indexOf(name);
    let b = e + 1;
    if (pv(toks[b]) === ':') { b++; while (b < toks.length && pv(toks[b]) !== '{' && pv(toks[b]) !== '=>') { if (pv(toks[b]) in OPEN) b = close(toks, b); b++; } }
    if (pv(toks[b]) === '=>') {
      const end = pv(toks[b + 1]) === '{' ? close(toks, b + 1) : exprEnd(toks, b + 1);
      if (end < at) continue;
    } else if (pv(toks[b]) === '{') {
      if (close(toks, b) < at) continue;
    } else continue;
    const before = toks[i - 1];
    if (before?.type === 'ident' && ['if', 'for', 'while', 'switch', 'catch', 'with'].includes(before.v)) continue;
    let fname = null;
    if (before?.type === 'ident' && !KEYWORDS.has(before.v) && before.v !== 'async') fname = before.v;
    else if (pv(before) === '=' && toks[i - 2]?.type === 'ident') fname = toks[i - 2].v;
    else if (before?.v === 'async' && pv(toks[i - 2]) === '=' && toks[i - 3]?.type === 'ident') fname = toks[i - 3].v;
    else if (pv(before) === '>') { const j = (() => { let d = 0; for (let x = i - 1; x >= 0; x--) { if (pv(toks[x]) === '>') d++; else if (pv(toks[x]) === '<') { d--; if (d === 0) return x; } } return 0; })(); if (toks[j - 1]?.type === 'ident') fname = toks[j - 1].v; }
    if (!fname || pv(before) === '(' || pv(before) === ',' || before?.v === 'async' && (pv(toks[i - 2]) === '(' || pv(toks[i - 2]) === ',')) {
      let j = i - 1;
      if (toks[j]?.v === 'async') j--;
      if (pv(toks[j]) === '(') {
        const call = toks[j - 1];
        if (call?.type === 'ident' && ITER.has(call.v) && (pv(toks[j - 2]) === '.' || pv(toks[j - 2]) === '?.')) {
          const r = j - 3;
          const s = pv(toks[r]) === ')' || pv(toks[r]) === ']' ? recvStart(toks, r) : r;
          return { iter: true, recv: toks.slice(s, r + 1), recvAt: s, sub, argIdx: idx };
        }
      }
      return { lambda: true };
    }
    const cls = f.classBodies.find(([a, z]) => i > a && i < z);
    const method = !!cls && depthIn(toks, cls[0], i) === 1;
    return { fname, idx, sub, method, cls: cls ? cls[2] : '', exported: new RegExp(`export\\s+(async\\s+)?(function|const|let)\\s+${fname}\\b`).test(f.text) };
  }
  for (let i = at; i >= 0; i--) {
    if (!(toks[i].type === 'ident' && toks[i].v === 'of')) continue;
    const p = toks[i - 1];
    let names = null;
    if (p?.type === 'ident') names = [p.v];
    else if (pv(p) === ']' || pv(p) === '}') names = paramNames(toks, open(toks, i - 1), i)[0]?.names ?? null;
    if (!names || !names.includes(name)) continue;
    let forOpen = -1;
    for (let j = i - 1, d = 0; j >= 0; j--) { const v = pv(toks[j]); if (SHUT.has(v)) d++; else if (v in OPEN) { if (d === 0) { forOpen = j; break; } d--; } }
    if (forOpen < 0 || toks[forOpen - 1]?.v !== 'for') continue;
    const forClose = close(toks, forOpen);
    if (forClose >= at) continue;
    const bodyStart = forClose + 1;
    const bodyEnd = pv(toks[bodyStart]) === '{' ? close(toks, bodyStart) : exprEnd(toks, bodyStart);
    if (bodyEnd < at) continue;
    return { iter: true, recv: toks.slice(i + 1, forClose), recvAt: i + 1, sub: pv(p) === ']' || pv(p) === '}' ? names.indexOf(name) : null, argIdx: 0 };
  }
  return null;
}

function recvStart(toks, r) {
  let s = open(toks, r);
  while (s > 0) {
    const b = toks[s - 1];
    if (b.type === 'ident' && !KEYWORDS.has(b.v)) { s--; continue; }
    if (pv(b) === '.' || pv(b) === '?.') { s--; continue; }
    if (pv(b) === ')' || pv(b) === ']') { s = open(toks, s - 1); continue; }
    break;
  }
  return s;
}

function elements(expr) {
  if (pv(expr[0]) !== '[' && pv(expr[0]) !== '{') return null;
  const e = close(expr, 0);
  return splitArgs(expr, 1, e).map((el) => {
    if (pv(expr[0]) === '{') { const c = el.findIndex((x) => pv(x) === ':'); return c >= 0 ? el.slice(c + 1) : el; }
    return el;
  });
}

function stripAs(expr) {
  let e = expr.length;
  for (let j = 0; j < expr.length; j++) { if (expr[j].type === 'ident' && (expr[j].v === 'as' || expr[j].v === 'satisfies') && depthIn(expr, 0, j) === 0) { e = j; break; } }
  return expr.slice(0, e);
}

function importTarget(files, f, name) {
  const m = f.text.match(new RegExp(`import\\s*(type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'([^']+)'`));
  if (!m) return null;
  const base = join(dirname(f.path), m[2]);
  return files.find((g) => g.path === base + '.ts') ?? files.find((g) => g.path === join(base, 'index.ts')) ?? null;
}

class Resolver {
  constructor(files) { this.files = files; this.byPath = new Map(files.map((f) => [f.path, f])); this.memo = new Map(); }

  expr(f, at, expr, depth, seen) {
    const out = new Set();
    if (depth > 6 || !expr.length) return out;
    expr = stripAs(expr);
    let d = 0, q = -1, c = -1, nested = 0, and = -1;
    for (let j = 0; j < expr.length; j++) {
      const v = pv(expr[j]);
      if (v in OPEN) d++;
      else if (SHUT.has(v)) d--;
      else if (d === 0 && v === '?') { if (q < 0) q = j; else nested++; }
      else if (d === 0 && v === ':' && q >= 0) { if (nested) nested--; else if (c < 0) c = j; }
      else if (d === 0 && v === '&&' && q < 0) and = j;
    }
    if (q > 0 && c > q) {
      for (const s of this.expr(f, expr[q + 1].i, expr.slice(q + 1, c), depth, seen)) out.add(s);
      for (const s of this.expr(f, expr[c + 1]?.i ?? at, expr.slice(c + 1), depth, seen)) out.add(s);
      return out;
    }
    if (and > 0) return this.expr(f, expr[and + 1]?.i ?? at, expr.slice(and + 1), depth, seen);
    const v = values(expr);
    v.out.forEach((s) => out.add(s));
    for (const r of v.refs) for (const s of this.ref(f, r.at ?? at, r.name, depth, seen, r.indexed)) out.add(s);
    for (const p of v.props) for (const s of this.prop(f, p.name, depth, seen)) out.add(s);
    for (const c of v.calls) for (const s of this.call(f, c, depth, seen)) out.add(s);
    return out;
  }

  collection(f, at, recv, sub, depth, seen) {
    const out = new Set();
    const r = stripAs(recv);
    if (!r.length) return out;
    if (r[0].type === 'ident' && r[0].v === 'Object' && pv(r[1]) === '.' && ['entries', 'values', 'keys'].includes(r[2]?.v) && pv(r[3]) === '(') {
      if (r[2].v === 'keys' || (r[2].v === 'entries' && sub === 0)) return out;
      return this.collection(f, at, r.slice(4, close(r, 3)), null, depth + 1, seen);
    }
    const els = elements(r);
    if (els && close(r, 0) === r.length - 1) {
      for (const el of els) {
        const inner = sub !== null && sub !== undefined ? elements(stripAs(el)) : null;
        const pick = inner ? inner[sub] : sub !== null && sub !== undefined ? null : el;
        if (pick) for (const s of this.expr(f, at, pick, depth + 1, seen)) out.add(s);
      }
      return out;
    }
    if (r.length === 1 && r[0].type === 'ident') {
      for (const d of this.decls(f, r[0].v)) for (const s of this.collection(d.f, d.at, d.expr, sub, depth + 1, seen)) out.add(s);
      return out;
    }
    if (r.length === 3 && r[0].v === 'this' && pv(r[1]) === '.') {
      const ds = declarations(f, r[2].v);
      if (ds.some((d) => d.expr[0]?.v === 'new' && d.expr[1]?.v === 'Map')) {
        const ts = f.toks;
        for (let i = 0; i + 4 < ts.length; i++) {
          if (!(ts[i].v === r[2].v && pv(ts[i - 1]) === '.' && pv(ts[i + 1]) === '.' && ts[i + 2].v === 'set' && pv(ts[i + 3]) === '(')) continue;
          const a = splitArgs(ts, i + 4, close(ts, i + 3))[sub === 1 ? 1 : 0];
          if (a && a.length) for (const s of this.expr(f, a[0].i, a, depth + 1, seen)) out.add(s);
        }
        return out;
      }
      for (const d of ds) for (const s of this.collection(f, d.at, d.expr, sub, depth + 1, seen)) out.add(s);
      return out;
    }
    if (pv(r[r.length - 1]) === ')') {
      const s0 = open(r, r.length - 1);
      const head = r[s0 - 1];
      if (head?.type === 'ident' && ['filter', 'slice', 'concat', 'sort', 'reverse'].includes(head.v) && (pv(r[s0 - 2]) === '.' || pv(r[s0 - 2]) === '?.')) return this.collection(f, at, r.slice(0, s0 - 2), sub, depth + 1, seen);
      if (head?.type === 'ident' && pv(r[s0 - 1 - 1]) !== '.' ) {
        for (const ret of this.returns(f, head.v)) for (const s of this.collection(ret.f, ret.at, ret.expr, sub, depth + 1, seen)) out.add(s);
        return out;
      }
    }
    if (sub === null || sub === undefined) for (const s of this.expr(f, at, r, depth + 1, seen)) out.add(s);
    return out;
  }

  decls(f, name) {
    const local = declarations(f, name).map((d) => ({ ...d, f }));
    if (local.length) return local;
    const g = importTarget(this.files, f, name);
    if (g) return declarations(g, name).map((d) => ({ ...d, f: g }));
    return [];
  }

  returns(f, name) {
    const local = returnsOf(f, name).map((r) => ({ ...r, f }));
    if (local.length) return local;
    const g = importTarget(this.files, f, name);
    if (g) return returnsOf(g, name).map((r) => ({ ...r, f: g }));
    if (name.length < 3) return [];
    return this.files.flatMap((h) => (h.text.includes(name) ? returnsOf(h, name).map((r) => ({ ...r, f: h })) : []));
  }

  ref(f, at, name, depth, seen, indexed) {
    const key = `ref:${f.path}:${at}:${name}`;
    if (seen.has(key)) return new Set();
    seen.add(key);
    const out = new Set();
    const enc = enclosing(f, at, name);
    if (enc && enc.iter) {
      for (const s of this.collection(f, enc.recvAt, enc.recv, enc.sub, depth + 1, seen)) out.add(s);
      return out;
    }
    if (enc && enc.fname) {
      for (const s of this.callSites(f, enc, depth, seen)) out.add(s);
      for (const d of declarations(f, name)) if (d.at > at - 400 && d.at < at) for (const s of this.expr(f, d.at, d.expr, depth + 1, seen)) out.add(s);
      return out;
    }
    if (enc && enc.lambda) return out;
    for (const d of this.decls(f, name)) {
      const els = indexed ? elements(stripAs(d.expr)) : null;
      if (els && close(stripAs(d.expr), 0) === stripAs(d.expr).length - 1) { for (const el of els) for (const s of this.expr(d.f, d.at, el, depth + 1, seen)) out.add(s); }
      else for (const s of this.expr(d.f, d.at, d.expr, depth + 1, seen)) out.add(s);
    }
    return out;
  }

  callSites(f, enc, depth, seen) {
    return this.cached(`call:${enc.method || enc.fname === 'constructor' ? enc.cls : f.path}:${enc.fname}:${enc.idx}:${enc.sub}`, () => this.callSitesRaw(f, enc, depth, new Set()));
  }

  callSitesRaw(f, enc, depth, seen) {
    const out = new Set();
    const scan = (g, test) => {
      const ts = g.toks;
      for (let i = 0; i < ts.length; i++) {
        if (!test(ts, i)) continue;
        const o = ts[i].type === 'ident' && ts[i].v === 'new' ? i + 2 : i + 1;
        if (pv(ts[o]) !== '(') continue;
        const e = close(ts, o);
        if (pv(ts[e + 1]) === '{' || (pv(ts[e + 1]) === ':' && !enc.method)) continue;
        const args = splitArgs(ts, o + 1, e);
        let a = args[enc.idx];
        if (!a) continue;
        if (enc.sub !== null && enc.sub !== undefined) { const els = elements(stripAs(a)); a = els ? els[enc.sub] : null; if (!a) continue; }
        for (const s of this.expr(g, a[0].i, a, depth + 1, seen)) out.add(s);
      }
    };
    if (enc.fname === 'constructor') {
      for (const g of this.files) {
        scan(g, (ts, i) => ts[i].type === 'ident' && ts[i].v === 'new' && ts[i + 1]?.v === enc.cls);
        for (const [a, z, , ext] of g.classBodies) if (ext === enc.cls) scan(g, (ts, i) => i > a && i < z && ts[i].type === 'ident' && ts[i].v === 'super');
      }
      return out;
    }
    if (enc.method) {
      const wide = enc.fname.length >= 6 && !COMMON_METHODS.has(enc.fname);
      for (const g of wide ? this.files : [f]) scan(g, (ts, i) => ts[i].type === 'ident' && ts[i].v === enc.fname && (pv(ts[i - 1]) === '.' || pv(ts[i - 1]) === '?.') && (g !== f || ts[i - 2]?.v === 'this' || !COMMON_METHODS.has(enc.fname)));
      return out;
    }
    for (const g of enc.exported ? this.files : [f]) scan(g, (ts, i) => ts[i].type === 'ident' && ts[i].v === enc.fname && pv(ts[i - 1]) !== '.' && pv(ts[i - 1]) !== '?.' && ts[i - 1]?.v !== 'function' && !MODIFIERS.has(ts[i - 1]?.v ?? ''));
    return out;
  }

  cached(key, make) {
    if (this.memo.has(key)) return this.memo.get(key);
    this.memo.set(key, new Set());
    const out = make();
    this.memo.set(key, out);
    return out;
  }

  prop(f, name, depth, seen) {
    return this.cached(`prop:${GLOBAL_PROPS.has(name) ? '' : f.path}:${name}`, () => this.propRaw(f, name, depth, new Set()));
  }

  propRaw(f, name, depth, seen) {
    const out = new Set();
    const scope = GLOBAL_PROPS.has(name) ? this.files : [f];
    for (const g of scope) {
      const ts = g.toks;
      for (let i = 0; i < ts.length; i++) {
        const k = ts[i];
        if (!((k.type === 'ident' || k.type === 'str') && k.v === name)) continue;
        const p = ts[i - 1];
        if ((pv(p) === '{' || pv(p) === ',') && pv(ts[i + 1]) === ':' && GLOBAL_PROPS.has(name)) {
          const j = i + 2;
          const expr = ts.slice(j, exprEnd(ts, j));
          if (pv(expr[0]) === '(' && pv(expr[1]) === ')' && pv(expr[2]) === '=>') { for (const s of this.expr(g, j + 3, expr.slice(3), depth + 1, seen)) out.add(s); continue; }
          if (expr.some((x) => pv(x) === '=>')) continue;
          for (const s of values(stripAs(expr)).out) out.add(s);
          continue;
        }
        if ((pv(p) === '.' || pv(p) === '?.') && pv(ts[i + 1]) === '=' && g === f && name !== 'value') {
          const j = i + 2;
          for (const s of this.expr(g, j, ts.slice(j, exprEnd(ts, j)), depth + 1, seen)) out.add(s);
        }
      }
    }
    if (name === 'value') for (const k of f.toks) for (const s of k.type === 'str' ? [k.v] : k.type === 'tpl' ? k.quasis : []) for (const m of s.matchAll(/<option value="([^"$]+)"/g)) out.add(m[1]);
    for (const s of this.dataset(name)) out.add(s);
    return out;
  }

  dataset(name) {
    return this.cached(`data:${name}`, () => this.datasetRaw(name));
  }

  datasetRaw(name) {
    const out = new Set();
    const attr = 'data-' + name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    const re = new RegExp(`${attr}="([^"$]+)"`, 'g');
    for (const g of this.files) {
      for (const k of g.toks) {
        const parts = k.type === 'str' ? [k.v] : k.type === 'tpl' ? k.quasis : [];
        for (const s of parts) for (const m of s.matchAll(re)) if (/\s/.test(m[1]) || /^[A-Z]/.test(m[1])) out.add(m[1]);
      }
      if (!g.text.includes(`dataset.${name}`)) continue;
      const ts = g.toks;
      for (let i = 0; i < ts.length; i++) {
        if (ts[i].type === 'ident' && ts[i].v === name && pv(ts[i - 1]) === '.' && ts[i - 2]?.v === 'dataset' && pv(ts[i + 1]) === '=') {
          const j = i + 2;
          for (const s of this.expr(g, j, ts.slice(j, exprEnd(ts, j)), 1, new Set())) out.add(s);
        }
      }
    }
    return out;
  }

  call(f, name, depth, seen) {
    if (name === 'label') return this.prop(f, 'label', depth, seen);
    if (SKIP_CALLS.has(name)) return new Set();
    const key = `fn:${f.path}:${name}`;
    if (seen.has(key)) return new Set();
    seen.add(key);
    const out = new Set();
    for (const r of this.returns(f, name)) for (const s of this.expr(r.f, r.at, r.expr, depth + 1, seen)) out.add(s);
    return out;
  }
}

export function extract() {
  const files = walkFiles(SRC).map((p) => {
    const text = readFileSync(p, 'utf8');
    const toks = lex(text);
    return { path: p, rel: relative(FRONT, p).split('\\').join('/'), text, toks, classBodies: classBodies(toks) };
  });
  const R = new Resolver(files);
  const keys = new Map();
  const unresolved = [];
  const add = (k, where) => {
    if (typeof k !== 'string') return;
    const key = norm(k);
    if (!/\p{L}/u.test(key)) return;
    if (!keys.has(key)) keys.set(key, new Set());
    keys.get(key).add(where);
  };
  for (const f of files) {
    const ts = f.toks;
    for (let i = 0; i < ts.length; i++) {
      const k = ts[i];
      if (k.type !== 'ident' || (k.v !== 't' && k.v !== 'tn') || pv(ts[i + 1]) !== '(') continue;
      const p = ts[i - 1];
      if (p && (pv(p) === '.' || pv(p) === '?.' || p.v === 'function' || MODIFIERS.has(p.v))) continue;
      const e = close(ts, i + 1);
      if (pv(ts[e + 1]) === '{' || (pv(ts[e + 1]) === ':' && (!p || pv(p) === '{' || pv(p) === '}' || pv(p) === ';'))) continue;
      const args = splitArgs(ts, i + 2, e);
      const where = `${f.rel}:${lineOf(f, k.pos)}`;
      const pick = k.v === 't' ? [args[0]] : [args[1], args[2]];
      for (const a of pick) {
        if (!a || !a.length) continue;
        const v = values(stripAs(a));
        const found = R.expr(f, a[0].i, a, 0, new Set());
        found.forEach((s) => add(s, where));
        const text = f.text.slice(a[0].pos, (ts[ts.indexOf(a[a.length - 1]) + 1] ?? a[a.length - 1]).pos).trim().split('\n')[0].slice(0, 120);
        if (v.dyn) unresolved.push({ where, why: 'a template literal with substitutions is not a key', expr: text });
        else if (!found.size) unresolved.push({ where, why: 'no English text found for this argument', expr: text });
      }
    }
  }
  return { keys, unresolved };
}

export function norm(k) {
  if (k.endsWith('...')) return k.slice(0, -3);
  if (k.endsWith(':') && !k.endsWith('::')) return k.slice(0, -1);
  return k;
}

export function readLangs() {
  const text = readFileSync(join(I18N, 'langs.ts'), 'utf8');
  const codes = [...(text.match(/LANG_CODES\s*=\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const parent = {};
  for (const m of (text.match(/LANG_PARENT[^=]*=\s*\{([^}]*)\}/)?.[1] ?? '').matchAll(/'?([\w-]+)'?\s*:\s*'([^']+)'/g)) parent[m[1]] = m[2];
  return { codes, parent };
}

export function readTable(code) {
  const parts = [];
  for (const part of PARTS) {
    const p = join(I18N, part, `${code}.ts`);
    if (!existsSync(p)) continue;
    const f = { text: readFileSync(p, 'utf8') };
    const toks = lex(f.text);
    const entries = [];
    for (let i = 0; i < toks.length; i++) {
      if (isStr(toks[i]) && pv(toks[i + 1]) === ':' && isStr(toks[i + 2]) && (pv(toks[i - 1]) === '{' || pv(toks[i - 1]) === ',')) {
        entries.push([toks[i].v, toks[i + 2].v, lineOf(f, toks[i].pos)]);
        i += 2;
      }
    }
    parts.push({ file: relative(FRONT, p).split('\\').join('/'), entries });
  }
  return parts;
}

const holes = (s) => [...s.matchAll(/\{[A-Za-z0-9_]+\}|%[sd]/g)].map((m) => m[0]).sort().join(' ');

function main() {
  const { keys, unresolved } = extract();
  const arg = process.argv[2];
  if (arg === '--keys') { process.stdout.write(JSON.stringify([...keys.keys()].sort(), null, 1) + '\n'); return; }
  if (arg === '--sources') { process.stdout.write(JSON.stringify(Object.fromEntries([...keys].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, [...v]])), null, 1) + '\n'); return; }
  if (arg === '--unresolved') { process.stdout.write(JSON.stringify(unresolved, null, 1) + '\n'); return; }
  const { codes, parent } = readLangs();
  const problems = [];
  const missingTables = [];
  let checked = 0;
  for (const code of codes) {
    if (code === 'en') continue;
    const parts = readTable(code);
    if (!parts.length) { missingTables.push(code); continue; }
    checked++;
    const seen = new Map();
    for (const { file, entries } of parts) {
      for (const [k, v, line] of entries) {
        const where = `${file}:${line}`;
        if (seen.has(k)) problems.push(`${where} ${code}: duplicate key "${k}" (also ${seen.get(k)})`);
        seen.set(k, where);
        const hash = k.lastIndexOf('#');
        const base = hash > 0 && PLURAL.has(k.slice(hash + 1)) ? k.slice(0, hash) : k;
        if (!keys.has(base)) problems.push(`${where} ${code}: key no longer in the source "${k}"`);
        else if (holes(base) !== holes(v)) problems.push(`${where} ${code}: placeholders differ in "${k}" [${holes(base)}] vs [${holes(v)}]`);
        if (v.includes('\u2014')) problems.push(`${where} ${code}: em dash in "${k}"`);
        if (!v.trim()) problems.push(`${where} ${code}: empty translation for "${k}"`);
      }
    }
    if (!parent[code]) {
      for (const k of [...keys.keys()].filter((x) => !seen.has(x)).sort()) problems.push(`${code}: no entry for "${k}" (${[...keys.get(k)][0]})`);
    } else if (!codes.includes(parent[code])) problems.push(`${code}: parent ${parent[code]} is not a listed language`);
    else if (!readTable(parent[code]).length) problems.push(`${code}: parent ${parent[code]} has no table`);
  }
  console.log(`i18n · ${keys.size} keys from the source · ${checked} of ${codes.length - 1} languages have a table`);
  if (missingTables.length) console.log(`no table yet: ${missingTables.join(' ')}`);
  if (unresolved.length) console.log(`${unresolved.length} t() arguments have no English text the check can see (node scripts/i18n-check.mjs --unresolved)`);
  if (problems.length) {
    for (const p of problems) console.log(`  FAIL   ${p}`);
    console.log(`${problems.length} problems`);
    process.exit(1);
  }
  console.log('ok');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
