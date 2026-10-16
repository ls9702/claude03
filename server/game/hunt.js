// 세계 설정 · 치이카와 모드 signature activities (pure helpers over a tx):
//   토벌 (討伐)       — tile `hunt` → prompt `hunt` (⚔️ 싸운다 / 🏃 도망친다) → event `huntResult`
//   풀뽑기 검정        — tile `weed` → prompt `weed` (🌿 일하기 / 📝 검정 응시) → event `weedResult`
// The tile types, prompts, events and rules are world-independent code; only the Chiikawa overlay puts the tiles into
// the board pools (server/data/worlds/chiikawa.json `board`), so the real world never sees one.
//
// character.hunts = 토벌 wins (public, init 0) · character.weed = {level 0..5 (1 = 5급 … 5 = 1급), tries} (public)
import { addLog, addStats, changeMoney, charById, emit, josa, round5, won } from './effects.js';
import { effectsFor } from './news.js';
import { openPrompt, registerPrompts } from './prompts.js';
import { INJURY_ID, applyLoss, cardDef, ensureCards, gainCard, injuryProof, itemDef, tryAmulet } from './cards.js';
import { PAYDAY_HOOKS, grantMerit, huntCount, jobDef, meritNeeded, weedLevel } from './jobs.js';

export { huntCount, weedLevel };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (p) => Math.round(p * 100);

/** Fill the 세계 설정 character fields (games started / saved before them). */
export function ensureWorldFields(c) {
  c.hunts ??= 0;
  if (!c.weed || typeof c.weed !== 'object') c.weed = { level: 0, tries: 0 };
  c.weed.level ??= 0;
  c.weed.tries ??= 0;
  return c;
}

// ---------- 토벌 ----------

export const huntCfg = (data) => data.hunts?.balance ?? {};
export const monsterDefs = (data) => data.hunts?.monsters ?? [];
export const monsterDef = (data, id) => monsterDefs(data).find((m) => m.id === id) ?? null;

/** Monsters that may appear in an era (eras filter; weight > 0). */
export function monsterPool(data, eraId) {
  return monsterDefs(data).filter((m) => (!m.eras || m.eras.includes(eraId)) && (m.weight ?? 1) > 0);
}

/** Item effect flags of a character's items (`huntBonus` = 사스마타, `huntArmor` = 갑옷). */
export const hasItemEffect = (data, c, key) => (c?.items ?? []).some((id) => !!itemDef(data, id)?.effect?.[key]);

/** Is the character's job a 토벌 job (hunts.balance.hunterJobs)? */
const hunterJob = (data, c) => (huntCfg(data).hunterJobs ?? ['hunter', 'legend_hunter']).includes(c?.job?.id);

/** 토벌 win chance against monster `m`: base[power-1] + 체력 / 운 + 사스마타 + 토벌대 rank, clamped. */
export function huntChance(tx, c, m) {
  const cfg = huntCfg(tx.data);
  const base = cfg.base?.[clamp((m?.power ?? 1) - 1, 0, (cfg.base?.length ?? 1) - 1)] ?? 0.5;
  let p = base + (cfg.perStr ?? 0) * (c.stats?.str ?? 0) + (cfg.perLuck ?? 0) * (c.stats?.luck ?? 0);
  if (hasItemEffect(tx.data, c, 'huntBonus')) p += cfg.sasumata ?? 0;
  if (hunterJob(tx.data, c)) p += (cfg.hunterRank ?? 0) * (c.job?.rank ?? 1);
  return clamp(p, cfg.min ?? 0.05, cfg.max ?? 0.95);
}

/** Era scale of 토벌 money (rewards and fail losses). */
const huntScale = (data, era) => huntCfg(data).eraScale?.[era] ?? 1;

/** Reward range [lo, hi] (만원) of monster `m` for `c`: × era scale × news huntRewardMult × the CPU income handicap. */
export function huntRewardRange(tx, c, m) {
  const eff = effectsFor(tx, c);
  const s = huntScale(tx.data, c.era) * (eff.huntRewardMult ?? 1) * (eff.incomeMult ?? 1);
  const lo = round5((m?.reward?.min ?? 0) * s);
  const hi = Math.max(lo, round5((m?.reward?.max ?? 0) * s));
  return [lo, hi];
}

/** 토벌 tile → the hunt prompt (a monster is drawn when it opens). */
export function resolveHuntTile(tx, c) {
  if (!monsterPool(tx.data, c.era).length) {
    addLog(tx, `⚔️ ${c.name}: 토벌하러 왔는데 키메라가 한 마리도 안 보인다`, { charId: c.id });
    return null;
  }
  return openPrompt(tx, 'hunt', c);
}

// ---------- 풀뽑기 검정 ----------

export const weedCfg = (data) => data.balance.weed ?? {};
export const WEED_MAX = 5;
/** 검정 level → grade label (1 = 5급 … 5 = 1급, 0 = 무자격). */
export const weedGrade = (level) => (level > 0 ? `${WEED_MAX + 1 - level}급` : '무자격');
const kidsEra = (data, era) => (weedCfg(data).kidsEras ?? ['baby', 'elem', 'middle', 'high']).includes(era);
const weedScale = (data, era) => weedCfg(data).eraScale?.[era] ?? 1;

/** 풀뽑기 work pay (만원): base × (1 + perLevel × level) × era × (풀뽑기 일꾼 job) × news weedMult × CPU income handicap. */
export function weedWorkAmount(tx, c) {
  const w = weedCfg(tx.data).work ?? {};
  const eff = effectsFor(tx, c);
  const weeder = (w.weederJobs ?? ['weeder', 'weed_sage']).includes(c.job?.id) ? w.weederMult ?? 1 : 1;
  const v = (w.base ?? 10) * (1 + (w.perLevel ?? 0) * weedLevel(c)) * weedScale(tx.data, c.era) * weeder * (eff.weedMult ?? 1) * (eff.incomeMult ?? 1);
  return Math.max(5, round5(v));
}

/** 검정 pass chance for the next grade (null at 1급). */
export function weedExamChance(tx, c) {
  const e = weedCfg(tx.data).exam ?? {};
  const level = weedLevel(c);
  if (level >= WEED_MAX) return null;
  const s = c.stats ?? {};
  const retry = Math.min(e.retryMax ?? 0.15, (e.retryBonus ?? 0) * (c.weed?.tries ?? 0));
  const p = (e.base?.[level] ?? 0.3) + (e.perInt ?? 0) * (s.int ?? 0) + (e.perStr ?? 0) * (s.str ?? 0) + (e.perLuck ?? 0) * (s.luck ?? 0) + retry;
  return clamp(p, e.min ?? 0.05, e.max ?? 0.9);
}

/** 검정 응시료 (kids eras: free — 부모님 찬스). */
export function weedExamFee(tx, c) {
  const e = weedCfg(tx.data).exam ?? {};
  const level = weedLevel(c);
  if (level >= WEED_MAX || kidsEra(tx.data, c.era)) return 0;
  return round5((e.fee?.[level] ?? 10) * weedScale(tx.data, c.era));
}

/** 풀뽑기 tile → the weed prompt. */
export const resolveWeedTile = (tx, c) => openPrompt(tx, 'weed', c);

// ---------- paydays of the 치이카와 jobs ----------

/**
 * 토벌대 (jobs.json `paydayPatrol: <monster id>`): every payday a quick patrol against that monster — no prompt, no
 * loss; a win (huntChance) counts as a 토벌 (hunts +1, log). 풀뽑기 일꾼 (`paydayWeedExam: true`): every payday a free
 * 검정 for the next grade — a pass = level +1 (`weedResult {action: 'exam', payday: true}`), a fail = tries +1 (log only).
 * Only these jobs roll (the real world never does).
 */
function paydayActivities(tx, c, def) {
  if (def?.paydayPatrol) {
    const m = monsterDef(tx.data, def.paydayPatrol) ?? monsterPool(tx.data, c.era)[0];
    if (m) {
      if (tx.rng.next() < huntChance(tx, c, m)) {
        c.hunts = huntCount(c) + 1;
        addLog(tx, `⚔️ ${c.name}: 순찰 중 ${m.icon} ${josa(m.name, '을/를')} 물리쳤다! (토벌 ${c.hunts}회)`, { tone: 'good', charId: c.id, emotion: 'joy' });
      } else addLog(tx, `⚔️ ${c.name}: 순찰 중 ${m.icon} ${josa(m.name, '을/를')} 놓쳤다…`, { tone: 'info', charId: c.id, emotion: 'sweat' });
    }
  }
  if (def?.paydayWeedExam && weedLevel(ensureWorldFields(c)) < WEED_MAX) {
    const level = weedLevel(c);
    const chance = weedExamChance(tx, c);
    if (tx.rng.next() < chance) {
      c.weed.level = level + 1;
      c.weed.tries = 0;
      const grade = weedGrade(c.weed.level);
      emit(tx, 'weedResult', { charId: c.id, action: 'exam', success: true, payday: true, level: c.weed.level, grade, target: level + 1, chance, tone: 'good', emotion: 'joy' });
      addLog(tx, `📝 ${c.name}, 일하면서 실력이 늘어 풀뽑기 ${grade} 검정 합격!${c.weed.level >= WEED_MAX ? ' 최고 급수 달성! 🌾' : ''}`, { tone: 'good', charId: c.id, emotion: 'joy' });
    } else {
      c.weed.tries += 1;
      addLog(tx, `📝 ${c.name}: 일하는 틈틈이 본 풀뽑기 ${weedGrade(level + 1)} 검정은 아쉽게 불합격`, { tone: 'info', charId: c.id, emotion: 'sweat' });
    }
  }
}
PAYDAY_HOOKS.push(paydayActivities);

// ---------- injury (토벌 defeat) ----------

/**
 * A forced injury (토벌 defeat): only with a job (the injury lives on `job.injured`); 건강기원 부적 / 건강 부적 prevent it.
 * @returns turns injured (0 = none)
 */
function huntInjury(tx, c) {
  if (!c.job || c.job.injured > 0) return 0;
  if (injuryProof(c)) {
    const d = cardDef(tx.data, 'health_charm');
    addLog(tx, `${d?.icon ?? '🧿'} ${c.name}: 다칠 뻔했지만 ${d?.name ?? '건강기원 부적'} 덕분에 멀쩡하다!`, { tone: 'good', charId: c.id, emotion: 'joy' });
    return 0;
  }
  if (tryAmulet(tx, c, 'injury')) return 0;
  const turns = tx.data.balance.jobs?.injuryTurns ?? 2;
  c.job.injured = turns;
  ensureCards(c);
  if (!c.cards.some((k) => k.id === INJURY_ID)) gainCard(tx, c, INJURY_ID, 'status', { log: false });
  return turns;
}

// ---------- prompts ----------

registerPrompts({
  /** 토벌: a monster appears — fight (chance, reward range) or run away (default, nothing happens). */
  hunt: {
    resultCutin: 'auto', // a fight anchors on huntResult; running away gets promptResolved {result: 'run'} (a banner)
    build(tx, c) {
      const m = tx.rng.weighted(monsterPool(tx.data, c.era));
      const chance = huntChance(tx, c, m);
      const reward = huntRewardRange(tx, c, m);
      const armor = hasItemEffect(tx.data, c, 'huntArmor');
      const sasumata = hasItemEffect(tx.data, c, 'huntBonus');
      const extras = [sasumata ? '🔱 사스마타 +' + pct(huntCfg(tx.data).sasumata ?? 0) + '%p' : '', armor ? '🛡️ 갑옷이 지켜 줘요' : ''].filter(Boolean);
      const options = [
        {
          id: 'fight',
          label: '⚔️ 싸운다',
          icon: '⚔️',
          desc: `이길 확률 약 ${pct(chance)}% · 보상 ${won(reward[0])}~${won(reward[1])}${extras.length ? ` · ${extras.join(' · ')}` : ''}`,
          chance,
          reward,
          monsterId: m.id,
          ...(armor ? { armor: true } : {}),
          ...(sasumata ? { sasumata: true } : {}),
        },
        { id: 'run', label: '🏃 도망친다', icon: '🏃', desc: '아무 일 없이 도망쳐요 (부끄럽지 않아!)' },
      ];
      return {
        forCharacterIds: [c.id],
        title: `⚔️ 토벌! ${m.icon} ${m.name} 등장`,
        text: `${m.desc} — ${josa(c.name, '은/는')} 어떻게 할까?`,
        options,
        defaultOptionId: 'run',
        context: { monsterId: m.id, monster: { id: m.id, name: m.name, icon: m.icon, power: m.power }, chance, reward, armor, sasumata, era: c.era },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const ctx = p.context ?? {};
      const m = monsterDef(tx.data, ctx.monsterId) ?? { id: ctx.monsterId, name: ctx.monster?.name ?? '키메라', icon: ctx.monster?.icon ?? '👾', power: 1 };
      if (p.answers[c.id] !== 'fight') {
        addLog(tx, `🏃 ${josa(c.name, '은/는')} ${m.icon} ${m.name}에게서 후다닥 도망쳤다!`, { tone: 'info', charId: c.id, emotion: 'sweat' });
        return { result: 'run', monsterId: m.id };
      }
      const cfg = huntCfg(tx.data);
      const chance = Number.isFinite(ctx.chance) ? ctx.chance : huntChance(tx, c, m);
      const armor = hasItemEffect(tx.data, c, 'huntArmor');
      const sasumata = hasItemEffect(tx.data, c, 'huntBonus');
      const base = { charId: c.id, monsterId: m.id, chance, armor, sasumata };
      if (tx.rng.next() < chance) {
        const [lo, hi] = Array.isArray(ctx.reward) ? ctx.reward : huntRewardRange(tx, c, m);
        const amount = round5(tx.rng.int(lo, hi));
        c.hunts = huntCount(c) + 1;
        emit(tx, 'huntResult', { ...base, success: true, amount, injured: 0, hunts: c.hunts, tone: 'good', emotion: 'joy' });
        changeMoney(tx, c, amount, 'hunt', { emotion: 'joy', tone: 'good', monsterId: m.id });
        addLog(tx, `⚔️ ${josa(c.name, '이/가')} ${m.icon} ${m.name} 토벌 성공! 보수 +${won(amount)} (토벌 ${c.hunts}회)`, { tone: 'good', charId: c.id, emotion: 'joy' });
        if (tx.rng.next() < (cfg.strChance ?? 0)) addStats(tx, c, { str: 1 }, 'hunt');
        const def = jobDef(tx.data, c.job?.id);
        if (hunterJob(tx.data, c) && meritNeeded(def) > 0 && tx.rng.next() < (cfg.meritChance ?? 0)) grantMerit(tx, c, '키메라 토벌 공으로');
        return { result: 'win', monsterId: m.id };
      }
      // defeat: a money loss (갑옷 halves it; 실손 보험 / 액땜 apply) and maybe an injury (갑옷: never)
      const eff = effectsFor(tx, c);
      const fl = cfg.failLoss ?? { min: 20, max: 50 };
      let loss = round5(tx.rng.int(fl.min, fl.max) * huntScale(tx.data, c.era));
      if (armor) loss = round5(loss * 0.5);
      const hurtChance = armor ? 0 : (cfg.injuryOnFail ?? 0) * (eff.huntInjuryMult ?? 1);
      const hurtRoll = !!c.job && hurtChance > 0 ? tx.rng.next() < hurtChance : false; // the injury lives on the job
      const ev = emit(tx, 'huntResult', { ...base, success: false, amount: -loss, injured: 0, hunts: huntCount(c), tone: 'bad', emotion: 'cry' });
      const lost = loss > 0 ? applyLoss(tx, c, loss, 'hunt', { emotion: 'cry', tone: 'bad', monsterId: m.id }).amount : 0;
      ev.amount = -lost;
      const turns = hurtRoll ? huntInjury(tx, c) : 0;
      ev.injured = turns;
      c.badEvents = (c.badEvents ?? 0) + 1;
      addLog(tx, `💥 ${josa(c.name, '이/가')} ${m.icon} ${m.name}에게 졌다… ${lost ? `-${won(lost)}` : ''}${armor ? ' (🛡️ 갑옷 덕분에 덜 다쳤다)' : ''}${turns ? ` 🤕 부상 ${turns}턴` : ''}`.replace(/\s+/g, ' ').trim(), {
        tone: 'bad',
        charId: c.id,
        emotion: 'cry',
      });
      return { result: 'lose', monsterId: m.id };
    },
  },

  /** 풀뽑기 검정소: work (money, default) or take the next 검정 (fee, pass chance). */
  weed: {
    resultCutin: 'auto', // weedResult anchors both actions
    build(tx, c) {
      const level = weedLevel(c);
      const grade = weedGrade(level);
      const amount = weedWorkAmount(tx, c);
      const w = weedCfg(tx.data).work ?? {};
      const chance = weedExamChance(tx, c);
      const fee = weedExamFee(tx, c);
      const options = [
        { id: 'work', label: `🌿 풀뽑기 일하기 (+${won(amount)})`, icon: '🌿', desc: `보수 ${won(amount)}${w.strChance ? ` · 가끔 체력 +1` : ''}`, amount },
      ];
      if (chance == null) {
        options.push({ id: 'exam', label: '📝 검정 응시', icon: '📝', desc: '이미 최고 급수(1급)예요!', disabled: true, level: WEED_MAX });
      } else {
        const target = level + 1;
        const short = fee > (c.money ?? 0);
        options.push({
          id: 'exam',
          label: `📝 ${weedGrade(target)} 검정 응시`,
          icon: '📝',
          desc: `합격 확률 약 ${pct(chance)}% · ${fee ? `응시료 ${won(fee)}` : '응시료 무료 (부모님 찬스)'}${short ? ' · 돈이 부족해요' : ''}`,
          chance,
          fee,
          price: fee,
          level: target,
          grade: weedGrade(target),
          ...(short ? { disabled: true } : {}),
        });
      }
      return {
        forCharacterIds: [c.id],
        title: '🌿 풀뽑기 검정소',
        text: `${c.name}의 풀뽑기 자격: ${grade}. 오늘은 뭘 할까?`,
        options,
        defaultOptionId: 'work',
        context: { level, grade, amount, chance, fee, era: c.era },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      ensureWorldFields(c);
      const ctx = p.context ?? {};
      const level = weedLevel(c);
      if (p.answers[c.id] === 'exam' && level < WEED_MAX) {
        const fee = weedExamFee(tx, c);
        if (fee > (c.money ?? 0)) {
          addLog(tx, `😅 ${c.name}: 응시료가 모자라서 검정은 다음 기회에…`, { tone: 'bad', charId: c.id, emotion: 'sweat' });
          return { result: 'noMoney' };
        }
        const chance = Number.isFinite(ctx.chance) ? ctx.chance : weedExamChance(tx, c);
        const pass = tx.rng.next() < chance;
        if (pass) {
          c.weed.level = level + 1;
          c.weed.tries = 0;
        } else c.weed.tries += 1;
        const grade = weedGrade(c.weed.level);
        emit(tx, 'weedResult', { charId: c.id, action: 'exam', success: pass, level: c.weed.level, grade, target: level + 1, chance, ...(fee ? { fee } : {}), tone: pass ? 'good' : 'bad', emotion: pass ? 'joy' : 'cry' });
        if (fee) changeMoney(tx, c, -fee, 'weedFee', { tone: 'neutral', emotion: 'sweat' });
        addLog(
          tx,
          pass
            ? `📝 ${c.name}, 풀뽑기 ${grade} 검정 합격!${c.weed.level >= WEED_MAX ? ' 최고 급수 달성! 🌾' : ''}`
            : `📝 ${c.name}, 풀뽑기 ${weedGrade(level + 1)} 검정 불합격… 다음엔 꼭!`,
          { tone: pass ? 'good' : 'bad', charId: c.id, emotion: pass ? 'joy' : 'cry' },
        );
        return { result: pass ? 'pass' : 'fail' };
      }
      const amount = weedWorkAmount(tx, c);
      emit(tx, 'weedResult', { charId: c.id, action: 'work', level, grade: weedGrade(level), amount, tone: 'good', emotion: 'joy' });
      changeMoney(tx, c, amount, 'weed', { tone: 'good', emotion: 'joy' });
      const w = weedCfg(tx.data).work ?? {};
      if (tx.rng.next() < (w.strChance ?? 0)) addStats(tx, c, { str: 1 }, 'weed');
      addLog(tx, `🌿 ${c.name}: 풀을 쏙쏙 뽑아서 보수 +${won(amount)}`, { tone: 'good', charId: c.id, emotion: 'joy' });
      return { result: 'work' };
    },
  },
});
