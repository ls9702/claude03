// Stage 7 — era openings: 전국 로또 (every era after the mode's first) and 명절 대잔치 (holidays.json eras).
// The first character entering an era queues it (`room.eraQueue`); the turn loop runs the queue once no prompt is
// open: the lotto draw (instant) first, then the holiday prompt (one simultaneous prompt for every unfinished
// character). Pure helpers over a tx; all randomness from tx.rng (seeded).
//
// room.erasOpened [eraId] · room.eraQueue [eraId] · room.holidayCount · room.holidays {eraId: seol|chuseok}
// room.lotto {draws: [{eraId, numbers, entries, at}]} (last balance.lotto.keepDraws)
import { STAT_KEYS, addLog, addStat, changeMoney, charById, emit, round5, statName, won } from './effects.js';
import { ensureCards } from './cards.js';
import { openPrompt, registerPrompts } from './prompts.js';

export const HOLIDAY_KINDS = ['seol', 'chuseok'];
export const STAKES = ['pass', 'small', 'big'];

/** First character entering an era → queue its opening (lotto + holiday). */
export function queueEraOpening(tx, eraId) {
  const room = tx.room;
  room.erasOpened ??= [];
  if (room.erasOpened.includes(eraId)) return false;
  room.erasOpened.push(eraId);
  room.eraQueue ??= [];
  room.eraQueue.push(eraId);
  return true;
}

/** Run queued era openings. @returns true when a (holiday) prompt opened */
export function runEraOpenings(tx) {
  const room = tx.room;
  while (room.eraQueue?.length) {
    const eraId = room.eraQueue.shift();
    lottoDraw(tx, eraId);
    if (openHoliday(tx, eraId)) return true;
  }
  return false;
}

// ---------- 전국 로또 ----------

/** `n` distinct numbers 1..pool (seeded partial Fisher–Yates), sorted. */
export function lottoNumbers(rng, pool, n) {
  const a = Array.from({ length: pool }, (_, i) => i + 1);
  for (let i = 0; i < n; i++) {
    const j = rng.int(i, pool - 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n).sort((x, y) => x - y);
}

const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/** Exact expected prize (만원) of one lotto ticket under `balance.lotto` (hypergeometric). */
export function lottoExpectedValue(cfg) {
  const { pool, pick } = cfg;
  const total = choose(pool, pick);
  let ev = 0;
  for (let k = 1; k <= pick; k++) ev += ((choose(pick, k) * choose(pool - pick, pick - k)) / total) * (cfg.prizes?.[k] ?? 0);
  return ev;
}

/**
 * Lotto draw of an era: every character holding a `lotto` card uses one (3 seeded numbers), then 3 numbers are
 * drawn. Emits `lottoDraw {eraId, numbers, entries: [{charId, numbers, matches, prize}]}` + prize moneyChanged.
 * @returns the draw or null (nobody held a ticket)
 */
export function lottoDraw(tx, eraId) {
  const room = tx.room;
  const holders = room.characters.filter((c) => ensureCards(c).cards.some((k) => k.id === 'lotto'));
  if (!holders.length) return null;
  const cfg = tx.data.balance.lotto ?? { pool: 20, pick: 3, prizes: { 3: 1000, 2: 100, 1: 10 } };
  const entries = holders.map((c) => {
    const i = c.cards.findIndex((k) => k.id === 'lotto');
    c.cards.splice(i, 1);
    return { charId: c.id, numbers: lottoNumbers(tx.rng, cfg.pool, cfg.pick) };
  });
  const numbers = lottoNumbers(tx.rng, cfg.pool, cfg.pick);
  for (const e of entries) {
    e.matches = e.numbers.filter((x) => numbers.includes(x)).length;
    e.prize = cfg.prizes?.[e.matches] ?? 0;
  }
  const winners = entries.filter((e) => e.prize > 0);
  emit(tx, 'lottoDraw', { eraId, numbers, entries: entries.map((e) => ({ ...e, numbers: [...e.numbers] })), tone: winners.length ? 'treasure' : 'neutral', emotion: winners.length ? 'joy' : 'sweat' });
  addLog(tx, `🎱 전국 로또 추첨! 당첨 번호 ${numbers.join(' · ')} (참가 ${entries.length}명)`, { tone: 'treasure' });
  for (const e of entries) {
    const c = charById(room, e.charId);
    if (e.prize > 0) {
      changeMoney(tx, c, e.prize, 'lotto', { tone: 'treasure', emotion: 'joy' });
      addLog(tx, `🎉 ${c.name}: ${e.matches}개 맞춤! 당첨금 ${won(e.prize)}`, { tone: 'good', charId: c.id, emotion: 'joy' });
    } else addLog(tx, `😅 ${c.name}: 꽝… (${e.numbers.join(' · ')})`, { tone: 'info', charId: c.id, emotion: 'sweat' });
  }
  room.lotto ??= { draws: [] };
  room.lotto.draws.push({ eraId, numbers, entries, at: tx.now });
  const keep = cfg.keepDraws ?? 10;
  if (room.lotto.draws.length > keep) room.lotto.draws.splice(0, room.lotto.draws.length - keep);
  return { eraId, numbers, entries };
}

// ---------- 명절 대잔치 ----------

const holidayCfg = (data) => data.holidays ?? {};

/** Does an era get a holiday (data eras, room config, not the mode's first era)? */
export function holidayEra(tx, eraId) {
  if (tx.room.config?.holidays === false) return false;
  if (tx.room.board?.eras?.[0]?.id === eraId) return false;
  return (holidayCfg(tx.data).eras ?? []).includes(eraId);
}

/** Stake amounts (만원) of a holiday era. */
export function holidayStakes(data, eraId) {
  const cfg = holidayCfg(data);
  const scale = cfg.stakeScale?.[eraId] ?? 1;
  return { small: round5((cfg.stakes?.small ?? 20) * scale), big: round5((cfg.stakes?.big ?? 60) * scale) };
}

/** Open the holiday prompt of an era (once). @returns true when opened */
export function openHoliday(tx, eraId) {
  const room = tx.room;
  if (!holidayEra(tx, eraId)) return false;
  room.holidays ??= {};
  if (Object.hasOwn(room.holidays, eraId)) return false;
  const players = room.turn.order.map((id) => charById(room, id)).filter((c) => c && !c.finished);
  if (!players.length) return false;
  const cfg = holidayCfg(tx.data);
  const kinds = cfg.kinds ?? HOLIDAY_KINDS;
  const kind = kinds[(room.holidayCount ?? 0) % kinds.length];
  room.holidayCount = (room.holidayCount ?? 0) + 1;
  room.holidays[eraId] = kind;
  const name = cfg.names?.[kind] ?? kind;
  emit(tx, 'holidayStarted', { eraId, kind, name, tone: 'holiday', emotion: 'joy' });
  addLog(tx, `${cfg.icons?.[kind] ?? '🎉'} ${name} 대잔치! 세배 룰렛·잔소리 룰렛에 고스톱 한 판`, { tone: 'holiday' });
  const current = charById(room, room.turn.order[room.turn.currentIndex]) ?? players[0];
  openPrompt(tx, 'holiday', current, { eraId, kind, players: players.map((c) => c.id) });
  return true;
}

registerPrompts({
  /** 명절 대잔치: everyone picks a 고스톱 stake (pass / small / big); 세배·잔소리 roulettes are automatic. */
  holiday: {
    build(tx, c, { eraId, kind, players }) {
      const cfg = holidayCfg(tx.data);
      const st = holidayStakes(tx.data, eraId);
      const name = cfg.names?.[kind] ?? kind;
      return {
        forCharacterIds: players,
        title: `${cfg.icons?.[kind] ?? '🎉'} ${name} 대잔치`,
        text: `온 가족이 모였다! 세배 룰렛과 잔소리 룰렛을 돌리고, 고스톱 한 판 칠까요? (가장 높은 끗수가 판돈을 가져가요)`,
        options: [
          { id: 'pass', label: '🙅 구경만 하기', icon: '🙅', desc: '고스톱은 안 쳐요 (세뱃돈·잔소리만)', stake: 0 },
          { id: 'small', label: `🎴 소소하게 (${won(st.small)})`, icon: '🎴', desc: `판돈 ${won(st.small)} · 화투 한 장 끗수 승부`, stake: st.small },
          { id: 'big', label: `🔥 크게 (${won(st.big)})`, icon: '🔥', desc: `판돈 ${won(st.big)} · 이기면 크게, 지면 아프게`, stake: st.big },
        ],
        defaultOptionId: 'pass',
        simultaneous: true,
        context: { eraId, kind, stakes: st },
      };
    },
    resolve(tx, p) {
      const room = tx.room;
      const cfg = holidayCfg(tx.data);
      const { eraId, kind, stakes } = p.context;
      const chars = p.forCharacterIds.map((id) => charById(room, id)).filter(Boolean);
      const results = chars.map((c) => ({ charId: c.id, sebae: 0, nagging: null, stake: 0, card: null, won: 0 }));
      const byId = new Map(results.map((r) => [r.charId, r]));
      const ev = emit(tx, 'holidayResult', { eraId, kind, name: cfg.names?.[kind] ?? kind, results, pot: 0, winners: [], tone: 'holiday', emotion: 'joy' });
      // ① 세배 룰렛: kids eras receive, adult eras give (never into debt)
      for (const c of chars) {
        const [lo, hi] = cfg.sebae?.[c.era] ?? [0, 0];
        let amt = tx.rng.int(lo, hi);
        amt = Math.abs(amt) < 5 ? 0 : Math.sign(amt) * round5(Math.abs(amt));
        if (amt < 0) amt = -Math.min(-amt, Math.max(0, c.money));
        byId.get(c.id).sebae = amt;
        if (amt) changeMoney(tx, c, amt, 'sebae', { tone: amt > 0 ? 'holiday' : 'bad', emotion: amt > 0 ? 'joy' : 'sweat' });
      }
      // ② 잔소리 룰렛: one random stat ±1
      const chance = cfg.nagging?.chance ?? 0.5;
      for (const c of chars) {
        const stat = STAT_KEYS[tx.rng.int(0, STAT_KEYS.length - 1)];
        const delta = tx.rng.next() < chance ? 1 : -1;
        const lines = cfg.nagging?.lines?.[stat] ?? [];
        const line = lines.length ? lines[tx.rng.int(0, lines.length - 1)] : '';
        const d = addStat(tx, c, stat, delta, 'nagging');
        byId.get(c.id).nagging = { stat, delta: d, line };
      }
      // ③ 고스톱: stakers draw a hwatu card; the best card wins min(own stake, winner's stake) from each loser
      const hw = cfg.hwatu ?? { min: 1, max: 10 };
      const stakers = [];
      for (const c of chars) {
        const pick = p.answers[c.id];
        const want = pick === 'big' ? stakes.big : pick === 'small' ? stakes.small : 0;
        const stake = Math.min(want, Math.max(0, c.money));
        if (stake > 0) stakers.push({ c, stake });
      }
      if (stakers.length >= 2) {
        for (const s of stakers) {
          s.card = tx.rng.int(hw.min, hw.max);
          Object.assign(byId.get(s.c.id), { stake: s.stake, card: s.card });
        }
        const best = Math.max(...stakers.map((s) => s.card));
        const winners = stakers.filter((s) => s.card === best);
        const cap = Math.max(...winners.map((s) => s.stake));
        let pot = 0;
        for (const s of stakers) {
          if (s.card === best) continue;
          const pay = Math.min(s.stake, cap);
          pot += pay;
          byId.get(s.c.id).won = -pay;
          changeMoney(tx, s.c, -pay, 'gostop', { tone: 'bad', emotion: 'cry' });
        }
        const share = Math.floor(pot / winners.length);
        winners.forEach((s, i) => {
          const got = share + (i === 0 ? pot - share * winners.length : 0);
          byId.get(s.c.id).won = got;
          if (got) changeMoney(tx, s.c, got, 'gostop', { tone: 'holiday', emotion: 'joy' });
        });
        ev.pot = pot;
        ev.winners = winners.map((s) => s.c.id);
        const names = winners.map((s) => s.c.name).join('·');
        addLog(tx, `🎴 고스톱 한 판! ${names} ${best}끗으로 승리${pot ? `, 판돈 ${won(pot)} 획득` : ''}`, { tone: 'holiday', charId: winners[0].c.id, emotion: 'joy' });
      } else if (stakers.length === 1) {
        byId.get(stakers[0].c.id).stake = 0;
        addLog(tx, `🎴 ${stakers[0].c.name}: 고스톱 칠 상대가 없어서 화투만 만지작…`, { charId: stakers[0].c.id, emotion: 'sweat' });
      }
      const name = cfg.names?.[kind] ?? kind;
      const summary = results.map((r) => {
        const c = charById(room, r.charId);
        const parts = [];
        if (r.sebae) parts.push(`세뱃돈 ${r.sebae > 0 ? '+' : ''}${won(r.sebae)}`);
        if (r.nagging?.delta) parts.push(`${statName(tx.data, r.nagging.stat)} ${r.nagging.delta > 0 ? '+1' : '−1'}`);
        return `${c.name}${parts.length ? ` (${parts.join(', ')})` : ''}`;
      });
      addLog(tx, `${cfg.icons?.[kind] ?? '🎉'} ${name} 정산: ${summary.join(' · ')}`, { tone: 'holiday' });
      return null;
    },
  },
});

