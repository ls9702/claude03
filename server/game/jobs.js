// Jobs (Stage 6, jobs.json): hiring (jobOffer), salary tiles, rank-ups (passive via exp + promotion exam),
// injuries, job tiles (promotion / change / overtime) and hidden-job unlocks. Pure helpers over a tx.
//
// character.job = {id, rank (1-based), exp, injured (remaining turns)} | null
// character.jobHistory = [{id, rank (highest reached), era (hired in)}] — every job held, the current one last
// character.hiddenUnlocked = [jobId] — hidden jobs whose conditions were met (offered at once, again on job tiles)
import { STAT_KEYS, addLog, addStats, changeMoney, emit, josa, netWorth, round5, won } from './effects.js';
import { effectsFor } from './news.js';
import { openPrompt, registerPrompts } from './prompts.js';
import { itemSalaryMult, salaryCardMult, tryAmulet } from './cards.js';

export const PART_TIME_ID = 'parttime';

export const allJobs = (data) => data.jobs?.jobs ?? [];
export const regularJobs = (data) => allJobs(data).filter((j) => !j.hidden);
export const hiddenJobs = (data) => allJobs(data).filter((j) => j.hidden);

/** Job definition by id (the part-time job included). */
export function jobDef(data, id) {
  if (!id) return null;
  const pt = data.jobs?.partTime;
  if (id === PART_TIME_ID || id === pt?.id) return pt ?? null;
  return allJobs(data).find((j) => j.id === id) ?? null;
}

export const maxRank = (def) => Math.max(1, def?.ranks?.length ?? 1);
export const rankName = (def, rank) => def?.ranks?.[Math.max(0, rank - 1)]?.name ?? '';
export const inJobEra = (data, c) => (data.balance.jobs?.jobEras ?? ['young', 'middle_age', 'senior']).includes(c?.era);

/** Minimum stat values a job asks of a character now (news `jobRequireDelta` / `jobDelta` applied). */
export function jobRequirements(def, eff) {
  const out = {};
  const base = def?.requires?.stats ?? {};
  const delta = (eff?.jobRequireDelta ?? 0) + (eff?.jobDelta?.[def?.id] ?? 0);
  for (const k of STAT_KEYS) {
    if (base[k] == null) continue;
    out[k] = Math.max(0, base[k] + delta);
  }
  return out;
}

const EDU_RANK = { none: 0, college: 1, elite: 2 };

/** Does a character meet a (regular) job's requirements under the given news effects? */
export function meetsRequirements(c, def, eff) {
  const req = jobRequirements(def, eff);
  for (const [k, v] of Object.entries(req)) if ((c.stats?.[k] ?? 0) < v) return false;
  const edu = def?.requires?.education;
  if (edu && (EDU_RANK[c.education] ?? 0) < (EDU_RANK[edu] ?? 0)) return false;
  return true;
}

/** Regular jobs a character may be offered now (hidden jobs never; `exclude` = ids to skip). */
export function eligibleJobs(tx, c, { exclude = [] } = {}) {
  const eff = effectsFor(tx, c);
  return regularJobs(tx.data).filter((j) => !exclude.includes(j.id) && meetsRequirements(c, j, eff));
}

/**
 * Offer weight of a job: demanding jobs (more required stat points, a degree) are offered more often to those
 * who qualify — `1 + perReq × (Σ required stats − 3) + education` (balance.jobs.offerWeight).
 */
export function offerWeight(def, data) {
  const w = data.balance.jobs?.offerWeight ?? { perReq: 0, education: 0 };
  const req = Object.values(def?.requires?.stats ?? {}).reduce((a, b) => a + b, 0);
  return 1 + (w.perReq ?? 0) * Math.max(0, req - 3) + (def?.requires?.education ? w.education ?? 0 : 0);
}

/** Up to `count` distinct eligible jobs, seeded (weighted by `offerWeight`, without replacement). */
export function offerCandidates(tx, c, { exclude = [], count = tx.data.balance.jobs?.offerCount ?? 3 } = {}) {
  const pool = eligibleJobs(tx, c, { exclude }).map((def) => ({ id: def.id, weight: offerWeight(def, tx.data) }));
  const out = [];
  while (pool.length && out.length < count) {
    const pick = tx.rng.weighted(pool);
    pool.splice(pool.indexOf(pick), 1);
    out.push(pick.id);
  }
  return out;
}

/** Take a job at rank 1. Emits `jobChanged {charId, jobId, fromJobId, rank, reason}`. */
export function hire(tx, c, jobId, reason) {
  const def = jobDef(tx.data, jobId);
  const from = c.job?.id ?? null;
  c.job = { id: def.id, rank: 1, exp: 0, injured: 0 };
  c.jobHistory ??= [];
  c.jobHistory.push({ id: def.id, rank: 1, era: c.era });
  const tone = def.tone ?? 'career';
  emit(tx, 'jobChanged', { charId: c.id, jobId: def.id, fromJobId: from, rank: 1, reason, tone, emotion: reason === 'parttime' ? 'sweat' : 'joy' });
  const r1 = rankName(def, 1);
  const text = {
    hire: `${def.icon} ${josa(c.name, '이/가')} ${def.name} ${josa(r1, '으로/로')} 취업했다!`,
    change: `🔄 ${c.name}, ${def.name} 「${r1}」부터 새 출발! (전직)`,
    hidden: `🌟 ${josa(c.name, '이/가')} 숨은 직업 「${def.name}」에 등극했다!`,
    parttime: `${def.icon} 조건에 맞는 직업이 없어 ${josa(c.name, '은/는')} ${def.name}부터 시작한다`,
  }[reason] ?? `${def.icon} ${c.name}: ${def.name}`;
  addLog(tx, text, { tone: reason === 'parttime' ? 'info' : tone, charId: c.id, emotion: reason === 'parttime' ? 'sweat' : 'joy' });
  return c.job;
}

/** Salary of the character's job (part-time rank 1 when jobless), news / era / injury applied. */
export function salaryAmount(tx, c) {
  const data = tx.data;
  const cfg = data.balance.jobs;
  const job = c.job ?? { id: PART_TIME_ID, rank: 1, injured: 0 };
  const def = jobDef(data, job.id);
  const base = def?.ranks?.[Math.min(maxRank(def), job.rank) - 1]?.salary ?? 0;
  const eff = effectsFor(tx, c);
  let mult = (cfg.salaryEraMult?.[c.era] ?? 1) * eff.salaryMult;
  if (def?.id === PART_TIME_ID) mult *= eff.partTimeMult;
  if (job.injured > 0) mult *= cfg.injurySalaryMult ?? 0.5;
  mult *= itemSalaryMult(data, c); // Stage 7: 노트북 (+10 % for creative / e-sports jobs)
  return round5(base * mult);
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Rank-up chance of the character's current job (exam = promotion exam on a job tile). */
export function rankUpChance(tx, c, { exam = false } = {}) {
  const cfg = tx.data.balance.jobs;
  const def = jobDef(tx.data, c.job?.id);
  if (!def?.rankUp) return 0;
  const ru = def.rankUp;
  const eff = effectsFor(tx, c);
  let p = ru.base + ru.perStat * (c.stats?.[ru.stat] ?? 0) + (cfg.luckBonus ?? 0) * (c.stats?.luck ?? 0) + eff.rankUpBonus;
  p += cfg.educationBonus?.[c.education] ?? 0; // 학력 보너스
  if (exam) p += cfg.examBonus ?? 0;
  return clamp(p, cfg.minChance ?? 0.05, cfg.maxChance ?? 0.9);
}

/**
 * Rank-up roll. Passive (salary / overtime) only when exp ≥ expNeeded; an injury blocks it.
 * @returns 'up' | 'fail' | 'blocked' | 'max' | 'notReady'
 */
export function tryRankUp(tx, c, { exam = false } = {}) {
  const data = tx.data;
  const job = c.job;
  const def = jobDef(data, job?.id);
  if (!def) return 'notReady';
  if (job.rank >= maxRank(def)) return 'max';
  if (!exam && job.exp < (def.rankUp?.expNeeded ?? 2)) return 'notReady';
  if (job.injured > 0) {
    addLog(tx, `🤕 ${c.name}: 부상 때문에 승진 심사를 받지 못했다…`, { tone: 'bad', charId: c.id, emotion: 'cry' });
    return 'blocked';
  }
  const p = rankUpChance(tx, c, { exam });
  if (tx.rng.next() < p) {
    job.rank += 1;
    job.exp = 0;
    const h = c.jobHistory?.findLast((x) => x.id === job.id);
    if (h) h.rank = Math.max(h.rank, job.rank);
    const rn = rankName(def, job.rank);
    emit(tx, 'rankUp', { charId: c.id, jobId: job.id, rank: job.rank, rankName: rn, tone: def.tone ?? 'career', emotion: 'joy' });
    addLog(tx, `🎉 ${c.name} 승진! ${def.name} 「${rn}」 (★${job.rank})`, { tone: 'good', charId: c.id, emotion: 'joy' });
    const gain = data.balance.jobs.rankUpStatGain ?? 0;
    if (gain && def.rankUp?.stat) addStats(tx, c, { [def.rankUp.stat]: gain }, 'rankUp');
    return 'up';
  }
  if (exam) addLog(tx, `😓 ${c.name}, 승진 시험에서 아쉽게 떨어졌다`, { tone: 'bad', charId: c.id, emotion: 'sweat' });
  return 'fail';
}

/** Injury roll for risky jobs (sports / fighting): `injuryRisk × news injuryMult`. */
export function rollInjury(tx, c) {
  const def = jobDef(tx.data, c.job?.id);
  if (!def?.injuryRisk || c.job.injured > 0) return false;
  const p = def.injuryRisk * effectsFor(tx, c).injuryMult;
  if (!(tx.rng.next() < p)) return false;
  if (tryAmulet(tx, c, 'injury')) return false; // Stage 7: 건강 부적
  const turns = tx.data.balance.jobs.injuryTurns ?? 2;
  c.job.injured = turns;
  c.badEvents = (c.badEvents ?? 0) + 1;
  emit(tx, 'injured', { charId: c.id, jobId: def.id, turns, tone: 'bad', emotion: 'cry' });
  addLog(tx, `🤕 ${c.name} 부상! ${turns}턴 동안 급여가 줄고 승진할 수 없다`, { tone: 'bad', charId: c.id, emotion: 'cry' });
  return true;
}

/** Military pay (while serving a salary tile / every serving spin pays this instead of a job salary). */
export function militaryPay(tx, c, why = '군 월급') {
  const pay = tx.data.balance.military?.pay ?? 0;
  if (!pay) return 0;
  changeMoney(tx, c, pay, 'military', { emotion: 'joy', tone: 'good' });
  addLog(tx, `🪖 ${c.name}: ${why} +${won(pay)}`, { tone: 'good', charId: c.id });
  return pay;
}

/** Salary tile. Serving → military pay; jobless (students) → part-time pay; else salary + exp + rank-up + injury. */
export function paySalary(tx, c) {
  if (c.military?.status === 'serving') return militaryPay(tx, c, '복무 중이라 군 월급만');
  const job = c.job;
  const amount = round5(salaryAmount(tx, c) * salaryCardMult(tx, c)); // Stage 7: 성과급 봉투 ×2
  const def = jobDef(tx.data, job?.id ?? PART_TIME_ID);
  const rank = job?.rank ?? 1;
  emit(tx, 'salary', { charId: c.id, jobId: def.id, rank, amount, tone: 'career', emotion: 'joy' });
  changeMoney(tx, c, amount, 'salary', { emotion: 'joy', tone: 'career', jobId: def.id });
  const who = job ? `${def.name} ${rankName(def, rank)}` : c.school ? '대학생 알바' : def.name;
  addLog(tx, `💵 ${c.name} 월급날! (${who}) +${won(amount)}${job?.injured > 0 ? ' (부상으로 감액)' : ''}`, { tone: 'good', charId: c.id, emotion: 'joy' });
  if (!job) return amount;
  job.exp += tx.data.balance.jobs.expPerSalary ?? 1;
  tryRankUp(tx, c);
  rollInjury(tx, c);
  return amount;
}

// ---------- hidden jobs ----------

/** Has the character reached the top rank of `jobId` (now or earlier in its career)? */
function reachedMaxRank(tx, c, jobId) {
  const def = jobDef(tx.data, jobId);
  const top = maxRank(def);
  if (c.job?.id === jobId && c.job.rank >= top) return true;
  return (c.jobHistory ?? []).some((h) => h.id === jobId && h.rank >= top);
}

/** Are a hidden job's `unlock` conditions met (all of them)? */
export function unlockMet(tx, c, def) {
  const u = def?.unlock;
  if (!u) return false;
  if (u.era && !u.era.includes(c.era)) return false;
  for (const [k, v] of Object.entries(u.stats ?? {})) if ((c.stats?.[k] ?? 0) < v) return false;
  if (u.money != null && (c.money ?? 0) < u.money) return false;
  if (u.netWorth != null && netWorth(c) < u.netWorth) return false;
  if (u.badEvents != null && (c.badEvents ?? 0) < u.badEvents) return false;
  if (u.maxRankOf && !u.maxRankOf.some((id) => reachedMaxRank(tx, c, id))) return false;
  return true;
}

/** Newly unlocked hidden jobs of a character (job eras only) → pushed to hiddenUnlocked + `hiddenJobUnlocked`. */
export function checkHiddenUnlocks(tx, c) {
  if (!inJobEra(tx.data, c) || c.finished) return [];
  c.hiddenUnlocked ??= [];
  const out = [];
  for (const def of hiddenJobs(tx.data)) {
    if (c.hiddenUnlocked.includes(def.id) || c.job?.id === def.id) continue;
    if (!unlockMet(tx, c, def)) continue;
    c.hiddenUnlocked.push(def.id);
    out.push(def.id);
    emit(tx, 'hiddenJobUnlocked', { charId: c.id, jobId: def.id, tone: 'result', emotion: 'shock' });
    addLog(tx, `🌟 숨은 직업 해금! ${josa(c.name, '이/가')} 「${def.icon} ${def.name}」의 자격을 얻었다`, { tone: 'result', charId: c.id, emotion: 'shock' });
  }
  return out;
}

/** An unlocked hidden job the character does not hold (offered again on job tiles). */
export const pendingHiddenJob = (c) => (c.hiddenUnlocked ?? []).find((id) => c.job?.id !== id) ?? null;

// ---------- job tiles ----------

/** Job tile: hidden offer > job-tile decision; students / soldiers / the jobless only look around. */
export function resolveJobTile(tx, c) {
  if (!inJobEra(tx.data, c)) {
    addLog(tx, `💼 ${c.name}: 직업 체험 부스를 구경했다`, { tone: 'career', charId: c.id });
    return null;
  }
  if (c.military?.status === 'serving') {
    addLog(tx, `🪖 ${c.name}: 복무 중이라 채용 공고만 구경했다`, { tone: 'career', charId: c.id });
    return null;
  }
  if (c.school) {
    addLog(tx, `🎓 ${c.name}: 대학생이라 인턴 공고만 스크랩했다`, { tone: 'career', charId: c.id });
    return null;
  }
  const hidden = pendingHiddenJob(c);
  if (hidden) return openPrompt(tx, 'hiddenJobOffer', c, { jobId: hidden });
  if (!c.job) return null; // the turn epilogue offers a job
  return openPrompt(tx, 'jobTile', c);
}

const pct = (p) => Math.round(p * 100);

registerPrompts({
  /** Hiring: up to 3 eligible jobs (requirements + education + news). */
  jobOffer: {
    build(tx, c, { candidates = [], after = null } = {}) {
      const options = candidates.map((id) => {
        const def = jobDef(tx.data, id);
        return {
          id,
          jobId: id,
          label: `${def.icon} ${def.name}`,
          icon: def.icon,
          desc: `${def.desc} · 첫 월급 ${won(def.ranks[0].salary)}${def.injuryRisk ? ' · 부상 위험' : ''}`,
        };
      });
      const lead = after === 'college' ? '졸업 축하! ' : after === 'military' ? '전역 축하! ' : '';
      return {
        forCharacterIds: [c.id],
        title: '💼 취업 제안',
        text: `${lead}${josa(c.name, '은/는')} 어떤 일을 할까요?`,
        options,
        defaultOptionId: options[0].id,
        context: { candidates },
      };
    },
    resolve(tx, p) {
      const c = tx.room.characters.find((x) => x.id === p.charId);
      hire(tx, c, p.answers[c.id], 'hire');
    },
  },

  /** Job tile: 승진 시험 (or 성과급 at max rank) / 전직 (one eligible candidate) / 야근. */
  jobTile: {
    resultCutin: 'auto',
    build(tx, c) {
      const def = jobDef(tx.data, c.job.id);
      const options = [];
      const top = c.job.rank >= maxRank(def);
      if (!top) {
        const p = rankUpChance(tx, c, { exam: true });
        const next = rankName(def, c.job.rank + 1);
        options.push({
          id: 'promotion',
          label: '📝 승진 시험',
          icon: '📝',
          desc: c.job.injured > 0 ? '부상 중이라 응시할 수 없어요' : `「${next}」 도전 · 성공 확률 약 ${pct(p)}%`,
        });
      } else {
        const b = tx.data.balance.jobs.maxRankBonus;
        const p = clamp(b.chance + b.luck * (c.stats?.luck ?? 0), 0, 0.95);
        options.push({ id: 'bonus', label: '💰 성과급 협상', icon: '💰', desc: `최고 랭크! 성공하면 월급 한 번 더 (약 ${pct(p)}%)` });
      }
      const [cand] = offerCandidates(tx, c, { exclude: [c.job.id], count: 1 });
      if (cand) {
        const nd = jobDef(tx.data, cand);
        const label = c.job.id === PART_TIME_ID ? `💼 정규직 도전: ${nd.name}` : `🔄 전직: ${nd.name}`;
        options.push({ id: 'change', jobId: cand, label, icon: nd.icon, desc: `${nd.ranks[0].name}부터 새 출발 · 첫 월급 ${won(nd.ranks[0].salary)}` });
      }
      const ot = tx.data.balance.jobs.overtime;
      options.push({ id: 'overtime', label: '🌙 야근', icon: '🌙', desc: `월급의 ${pct(ot.salaryShare)}% + 경험치 +${ot.exp} · 체력 −1` });
      return {
        forCharacterIds: [c.id],
        title: `💼 ${def.name} 직업 칸`,
        text: `${def.icon} ${def.name} ${rankName(def, c.job.rank)} ${c.name}, 이번엔 뭘 할까?`,
        options,
        defaultOptionId: options[0].id,
        context: { candidate: cand ?? null },
      };
    },
    resolve(tx, p) {
      const c = tx.room.characters.find((x) => x.id === p.charId);
      const choice = p.answers[c.id];
      const def = jobDef(tx.data, c.job.id);
      if (choice === 'promotion') {
        const r = tryRankUp(tx, c, { exam: true });
        if (r === 'fail') c.job.exp += 1;
        rollInjury(tx, c);
        return { result: r === 'up' ? 'promoted' : r === 'blocked' ? 'blocked' : 'failed' };
      }
      if (choice === 'bonus') {
        const b = tx.data.balance.jobs.maxRankBonus;
        const chance = clamp(b.chance + b.luck * (c.stats?.luck ?? 0), 0, 0.95);
        if (tx.rng.next() < chance) {
          const amount = round5(salaryAmount(tx, c) * b.salaryShare);
          changeMoney(tx, c, amount, 'bonus', { emotion: 'joy', tone: 'career' });
          addLog(tx, `💰 ${c.name} 성과급 협상 성공! +${won(amount)}`, { tone: 'good', charId: c.id, emotion: 'joy' });
          return { result: 'bonus' };
        }
        addLog(tx, `😅 ${c.name}, 성과급 협상은 결렬됐다`, { tone: 'bad', charId: c.id, emotion: 'sweat' });
        return { result: 'noBonus' };
      }
      if (choice === 'change' && p.context?.candidate) {
        hire(tx, c, p.context.candidate, 'change');
        return { result: 'changed' };
      }
      // overtime (also the fallback)
      const ot = tx.data.balance.jobs.overtime;
      const amount = round5(salaryAmount(tx, c) * ot.salaryShare);
      changeMoney(tx, c, amount, 'overtime', { emotion: 'sweat', tone: 'career' });
      addLog(tx, `🌙 ${c.name} 야근! 수당 +${won(amount)} (${def.name})`, { tone: 'career', charId: c.id, emotion: 'sweat' });
      c.job.exp += ot.exp ?? 2;
      addStats(tx, c, ot.stats ?? {}, 'overtime');
      tryRankUp(tx, c);
      return { result: 'overtime' };
    },
  },

  /** Hidden job unlocked: switch now? */
  hiddenJobOffer: {
    build(tx, c, { jobId }) {
      const def = jobDef(tx.data, jobId);
      const cur = c.job ? jobDef(tx.data, c.job.id) : null;
      return {
        forCharacterIds: [c.id],
        title: '🌟 숨은 직업 제안',
        text: `${josa(c.name, '이/가')} 「${def.icon} ${def.name}」의 자격을 얻었다! 전직할까요?`,
        options: [
          { id: 'accept', jobId, label: `${def.icon} ${def.name} 되기`, icon: def.icon, desc: `${def.desc} · 첫 월급 ${won(def.ranks[0].salary)}` },
          { id: 'decline', label: cur ? `🙅 ${cur.name} 계속하기` : '🙅 나중에', icon: '🙅', desc: '다음 직업 칸에서 다시 제안돼요' },
        ],
        defaultOptionId: 'accept',
        context: { jobId },
      };
    },
    resolve(tx, p) {
      const c = tx.room.characters.find((x) => x.id === p.charId);
      if (p.answers[c.id] === 'accept') hire(tx, c, p.context.jobId, 'hidden');
      else addLog(tx, `🙅 ${josa(c.name, '은/는')} 지금 직업을 계속하기로 했다`, { charId: c.id });
    },
  },
});

/** Open the job offer (true) or, without any eligible job, start as 알바 at once (false). */
export function offerJob(tx, c, { after = null } = {}) {
  const candidates = offerCandidates(tx, c);
  if (!candidates.length) {
    hire(tx, c, PART_TIME_ID, 'parttime');
    return false;
  }
  openPrompt(tx, 'jobOffer', c, { candidates, after });
  return true;
}

