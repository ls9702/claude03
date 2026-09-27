import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { GameRunner } from '../server/store/gameRunner.js';
import { httpCall, sseReader, tempDir } from './helpers.js';

let srv;
let tmp;

before(async () => {
  tmp = await tempDir();
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: tmp.dir, adminPassword: 'pw', debounceMs: 10 });
});

after(async () => {
  await srv?.close();
  await tmp?.cleanup();
});

const call = (method, path, opts) => httpCall(srv.url, method, path, opts);

async function adminCookie() {
  const login = await call('POST', '/admin/api/login', { body: { password: 'pw' } });
  return login.headers.get('set-cookie').split(';')[0];
}

async function setupRoom(config) {
  const cookie = await adminCookie();
  const { id, code } = (await call('POST', '/admin/api/rooms', { cookie, body: config })).json.room;
  const A = (await call('POST', '/api/session')).json.token;
  const B = (await call('POST', '/api/session')).json.token;
  await call('POST', '/api/rooms/join', { token: A, body: { code, name: '에이' } });
  await call('POST', '/api/rooms/join', { token: B, body: { code, name: '비' } });
  const a1 = (await call('POST', `/api/rooms/${id}/characters`, { token: A, body: { name: '에이1' } })).json.characterId;
  const b1 = (await call('POST', `/api/rooms/${id}/characters`, { token: B, body: { name: '비1' } })).json.characterId;
  return { cookie, id, A, B, a1, b1 };
}

test('actions endpoint: start → spin/choose loop → finished (HTTP + SSE)', async () => {
  const { cookie, id, A, B, a1, b1 } = await setupRoom({ mode: 'kids', eraTurns: { baby: 2, elem: 2, middle: 2, high: 3 } });
  const tokenOf = { [a1]: A, [b1]: B };

  // actions before start are rejected
  assert.equal((await call('POST', `/api/rooms/${id}/actions`, { token: A, body: { type: 'spin', characterId: a1 } })).status, 409);

  const ctrl = new AbortController();
  const res = await fetch(`${srv.url}/api/rooms/${id}/events?token=${B}`, { signal: ctrl.signal });
  const until = sseReader(res.body);

  const started = await call('POST', `/admin/api/rooms/${id}/start`, { cookie });
  assert.equal(started.status, 200);
  assert.equal(started.json.room.board.eras.length, 4);
  const playing = await until((f) => f.event === 'state' && f.data.status === 'playing');
  assert.ok(playing.data.board);
  assert.equal(playing.data.rngState, undefined);
  assert.equal(playing.data.characters[0].money, 1000);

  // validation
  assert.equal((await call('POST', `/api/rooms/${id}/actions`, { token: A, body: { type: 'nope' } })).status, 400);
  assert.equal((await call('POST', `/api/rooms/${id}/actions`, { token: B, body: { type: 'spin', characterId: a1 } })).status, 403);
  assert.equal((await call('POST', `/api/rooms/${id}/actions`, { token: B, body: { type: 'spin', characterId: b1 } })).status, 409);
  const other = (await call('POST', '/api/session')).json.token;
  assert.equal((await call('POST', `/api/rooms/${id}/actions`, { token: other, body: { type: 'spin', characterId: a1 } })).status, 403);

  // side bet by B on A's spin
  const bet = await call('POST', `/api/rooms/${id}/actions`, { token: B, body: { type: 'bet', characterId: b1, kind: 'oddEven', pick: 'odd', amount: 10 } });
  assert.equal(bet.status, 200, bet.text);

  const first = await call('POST', `/api/rooms/${id}/actions`, { token: A, body: { type: 'spin', characterId: a1 } });
  assert.equal(first.status, 200, first.text);
  assert.ok(first.json.events.some((e) => e.type === 'spun'));
  assert.ok(first.json.events.some((e) => e.type === 'betResolved'));
  const evFrame = await until((f) => f.event === 'events' && f.data.events.some((e) => e.type === 'spun'));
  assert.equal(typeof evFrame.data.version, 'number');

  let room = first.json.room;
  let chose = 0;
  for (let i = 0; i < 200 && room.status === 'playing'; i++) {
    const p = room.turn.pending;
    let r;
    if (p) {
      const cid = p.forCharacterIds.find((x) => !p.answered.includes(x));
      r = await call('POST', `/api/rooms/${id}/actions`, { token: tokenOf[cid], body: { type: 'choose', characterId: cid, promptId: p.promptId, optionId: p.options.find((o) => !o.disabled).id } });
      chose++;
    } else {
      const cid = room.turn.order[room.turn.currentIndex];
      r = await call('POST', `/api/rooms/${id}/actions`, { token: tokenOf[cid], body: { type: 'spin', characterId: cid } });
    }
    assert.equal(r.status, 200, r.text);
    room = r.json.room;
  }
  assert.equal(room.status, 'finished');
  assert.ok(chose >= 2, 'both characters stop at the exam tile');
  assert.equal(room.result.ranking.length, 2);
  await until((f) => f.event === 'events' && f.data.events.some((e) => e.type === 'gameOver'));
  const final = await call('GET', `/api/rooms/${id}`, { token: A });
  assert.equal(final.json.status, 'finished');
  assert.ok(final.json.log.some((l) => l.text.includes('게임 종료')));
  assert.equal((await call('POST', `/api/rooms/${id}/actions`, { token: A, body: { type: 'spin', characterId: a1 } })).status, 409);
  ctrl.abort();
});

test('admin force-timeout and force-end keep a ranking', async () => {
  const { cookie, id, A, a1 } = await setupRoom({ mode: 'adult', eraTurns: { young: 5, middle_age: 5, senior: 3 } });
  await call('POST', `/admin/api/rooms/${id}/start`, { cookie });
  // adult mode: first step lands on the 갈림길 stop → Stage 6: the job offer comes first, then routeChoice
  const r = await call('POST', `/api/rooms/${id}/actions`, { token: A, body: { type: 'spin', characterId: a1 } });
  assert.equal(r.json.room.turn.pending.kind, 'jobOffer');
  // players can't time out a prompt without a deadline
  assert.equal((await call('POST', `/api/rooms/${id}/actions`, { token: A, body: { type: 'timeout' } })).status, 409);
  const t0 = await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'timeout' } });
  assert.equal(t0.status, 200, t0.text);
  assert.equal(t0.json.room.turn.pending.kind, 'routeChoice');
  assert.ok(t0.json.room.characters.find((c) => c.id === a1).job?.id, 'hired with the default offer');
  const t = await call('POST', `/admin/api/rooms/${id}/actions`, { cookie, body: { type: 'timeout' } });
  assert.equal(t.status, 200, t.text);
  assert.equal(t.json.room.turn.pending, null);
  assert.equal(t.json.room.characters.find((c) => c.id === a1).route, 'career');
  const end = await call('POST', `/admin/api/rooms/${id}/end`, { cookie });
  assert.equal(end.json.room.status, 'finished');
  assert.equal(end.json.room.result.forced, true);
  assert.equal(end.json.room.result.ranking.length, 2);
});

test('runner fires timeout when pending.deadlineAt passes (and re-arms on restore)', async () => {
  const { cookie, id } = await setupRoom({ mode: 'kids' });
  await call('POST', `/admin/api/rooms/${id}/start`, { cookie });
  const store = srv.store;
  const arm = (runner, ms) => {
    const room = structuredClone(store.getRoom(id));
    const [x, y] = room.turn.order;
    room.turn.phase = 'awaitDecision';
    room.turn.pending = {
      promptId: `prT${ms}`,
      kind: 'groupGift',
      charId: x,
      title: 't',
      text: 't',
      forCharacterIds: [y],
      options: [{ id: 'gift' }, { id: 'skip' }],
      defaultOptionId: 'skip',
      answers: {},
      deadlineAt: Date.now() + ms,
      context: { gift: 10 },
    };
    store.put(room);
    runner.schedule(room);
  };
  arm(srv.runner, 40);
  await new Promise((r) => setTimeout(r, 150));
  let room = store.getRoom(id);
  assert.equal(room.turn.pending, null);
  assert.ok(room.log.some((l) => l.text.includes('시간 초과')));

  // a fresh runner (as after reboot) re-arms from stored state
  srv.runner.stop();
  arm({ schedule() {} }, 30);
  const reborn = new GameRunner(store);
  reborn.restore();
  await new Promise((r) => setTimeout(r, 120));
  room = store.getRoom(id);
  assert.equal(room.turn.pending, null);
  reborn.stop();
});
