import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jinsei-test-'));
  // retries: a late background write (AI art step, presence save) can race the removal (ENOTEMPTY)
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) };
}

/** A bare lobby room object (no store) for pure rule tests. */
export function makeRoom(overrides = {}) {
  return {
    id: 'abcd1234',
    code: 'ABCDEF',
    status: 'lobby',
    config: {
      mode: 'lifetime',
      eraTurns: { baby: 3, elem: 5, middle: 4, high: 5, young: 15, middle_age: 15, senior: 6 },
      maxCharacters: 8,
      startingMoney: 1000,
      allowCpu: false,
      turnOrder: 'family',
      holidays: false, // Stage 7: pre-Stage-7 rule tests run without 명절 prompts (stage7 tests turn them on)
    },
    players: [],
    characters: [],
    turn: null,
    log: [],
    seed: 42,
    version: 1,
    nextPlayerSeq: 0,
    nextCharSeq: 0,
    createdAt: 0,
    ...overrides,
  };
}

/** JSON HTTP call against a test server. */
export async function httpCall(baseUrl, method, path, { body, token, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['x-session-token'] = token;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** SSE frame reader over a fetch Response body; keeps unread frames between calls. */
export function sseReader(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  let buf = '';
  const parse = () => {
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = chunk.match(/^event: (.+)$/m)?.[1];
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (ev) frames.push({ event: ev, data: data ? JSON.parse(data) : null });
    }
  };
  /** Resolve with the first frame (in arrival order) matching predicate. */
  return async function until(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (frames.length) {
        const f = frames.shift();
        if (predicate(f)) return f;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('SSE: expected frame not received');
      let timer;
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('SSE timeout')), left))),
      ]).finally(() => clearTimeout(timer));
      if (done) throw new Error('SSE stream ended');
      buf += decoder.decode(value, { stream: true });
      parse();
    }
  };
}
