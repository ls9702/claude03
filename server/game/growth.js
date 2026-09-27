// Growth (Stage 6): stats, habits, 수능, 진로 (대학·취업·재수), 군 복무 and the per-turn "life step" that opens
// career / military / job-offer / route prompts in order. Pure helpers over a tx.
//
// Character fields (all public via viewFor):
//   stats {int, str, charm, luck} 0..cap · education none|college|elite · examResult elite|college|fail|null
//   military {status: none|serving|done|exempt, turnsLeft, deferred?} · job/jobHistory/hiddenUnlocked (jobs.js)
//   school {tier: college|elite, turnsLeft} | null (enrolled, graduates when turnsLeft hits 0)
//   careerDone (진로 decided) · retook (재수 used) · skipTurns (turns to sit out) · badEvents (bad luck survived)
import { tileAt } from './board.js';
import { STAT_KEYS, addDebt, addLog, addStats, changeMoney, charById, emit, josa, round5, statName, statText, won } from './effects.js';
import { checkHiddenUnlocks, inJobEra, offerJob } from './jobs.js';
import { effectsFor } from './news.js';
import { openPrompt, registerPrompts } from './prompts.js';
import { proposeStep } from './family.js';

export const EDUCATIONS = ['none', 'college', 'elite'];
export const EXAM_RESULTS = ['elite', 'college', 'fail'];
export const MILITARY_STATUSES = ['none', 'serving', 'done', 'exempt'];

const bodyOf = (c) => (c?.avatar?.body === 'girl' ? 'girl' : 'boy');

/** A fresh life record. `adult` = the game starts in 청년 (adult mode): grown-up stats, a random education. */
export function initLife(c, { rng, data, adult = false }) {
  const s = data.balance.stats;
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, s.start]));
  const points = s.randomPoints + (adult ? s.adultPoints ?? 0 : 0);
  for (let i = 0; i < points; i++) {
    const k = STAT_KEYS[rng.int(0, STAT_KEYS.length - 1)];
    stats[k] = Math.min(s.cap, stats[k] + 1);
  }
  let education = 'none';
  let military = { status: 'none', turnsLeft: 0 };
  if (adult) {
    const w = data.balance.career.adultEducation ?? { none: 1 };
    education = rng.weighted(Object.entries(w).map(([id, weight]) => ({ id, weight }))).id;
    military = { status: (data.balance.military.mandatory ?? []).includes(bodyOf(c)) ? 'done' : 'exempt', turnsLeft: 0 };
  }
  return {
    stats,
    education,
    examResult: null,
    military,
    job: null,
    jobHistory: [],
    hiddenUnlocked: [],
    school: null,
    careerDone: adult,
    retook: false,
    skipTurns: 0,
    badEvents: 0,
  };
}

/** Fill Stage 6 fields on characters of games saved before Stage 6 (restored mid-game). */
export function ensureLife(c, data) {
  if (c.stats && c.military) return c;
  const s = data.balance.stats;
  c.stats ??= Object.fromEntries(STAT_KEYS.map((k) => [k, s.start]));
  c.education ??= 'none';
  c.examResult ??= null;
  const inAdultEra = inJobEra(data, c);
  c.military ??= { status: inAdultEra ? 'exempt' : 'none', turnsLeft: 0 };
  c.job ??= null;
  c.jobHistory ??= [];
  c.hiddenUnlocked ??= [];
  c.school ??= null;
  c.careerDone ??= inAdultEra;
  c.retook ??= false;
  c.skipTurns ??= 0;
  c.badEvents ??= 0;
  return c;
}

// ---------- 수능 ----------

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * 수능 chances for a choice (study|guess): `{elite, college}` where `college` = P(일반대 or better).
 * base + int×지력 + luck×운 + news examBonus (+ retakeBonus on a 재수), clamped to [min, max].
 */
export function examChances(c, choice, data, { examBonus = 0, retake = false } = {}) {
  const cfg = data.balance.exam;
  const t = cfg[choice] ?? cfg.study;
  const extra = examBonus + (retake ? cfg.retakeBonus ?? 0 : 0);
  const f = (row) => clamp(row.base + row.int * (c.stats?.int ?? 0) + row.luck * (c.stats?.luck ?? 0) + extra, cfg.min, cfg.max);
  const college = f(t.college);
  const elite = Math.min(college, f(t.elite));
  return { elite, college };
}

/** Result of a roll r ∈ [0, 1). */
export const examOutcome = (chances, r) => (r < chances.elite ? 'elite' : r < chances.college ? 'college' : 'fail');

const EXAM_LABEL = { elite: '명문대 합격', college: '대학 합격', fail: '불합격' };

// ---------- military / school lifecycle ----------

export function startMilitary(tx, c) {
  const turns = tx.data.balance.military.turns ?? 2;
  c.military = { status: 'serving', turnsLeft: turns };
  emit(tx, 'militaryStart', { charId: c.id, turns, tone: 'neutral', emotion: 'sweat' });
  addLog(tx, `🪖 ${c.name} 입대! 룰렛 ${turns}번은 절반만 이동하고 군 월급을 받는다`, { tone: 'info', charId: c.id, emotion: 'sweat' });
}

export function endMilitary(tx, c) {
  c.military = { status: 'done', turnsLeft: 0 };
  emit(tx, 'militaryEnd', { charId: c.id, tone: 'good', emotion: 'joy' });
  addLog(tx, `🎖️ ${c.name} 전역! 늠름해져서 돌아왔다`, { tone: 'good', charId: c.id, emotion: 'joy' });
  addStats(tx, c, { str: tx.data.balance.military.strGain ?? 2 }, 'military');
}

export function graduate(tx, c) {
  const tier = c.school.tier;
  c.school = null;
  c.education = tier;
  emit(tx, 'educationChanged', { charId: c.id, education: tier, tone: 'good', emotion: 'joy' });
  addLog(tx, `🎓 ${c.name} ${tier === 'elite' ? '명문대' : '대학'} 졸업! 학사모를 던졌다`, { tone: 'good', charId: c.id, emotion: 'joy' });
  addStats(tx, c, tx.data.balance.career.graduationStats ?? {}, 'graduation');
}

/** Per-spin bookkeeping (before moving): military halves the move + pays, school / injury count down. */
export function spinSteps(tx, c, value) {
  ensureLife(c, tx.data);
  let steps = value;
  if (c.military.status === 'serving') {
    steps = Math.max(1, Math.ceil(value / 2));
    c.military.turnsLeft = Math.max(0, c.military.turnsLeft - 1);
  } else if (c.school) {
    c.school.turnsLeft = Math.max(0, c.school.turnsLeft - 1);
  }
  if (c.job?.injured > 0) c.job.injured -= 1;
  return steps;
}

/** Is the character standing on an unanswered 갈림길 (routeChoice stop)? */
function atRouteStop(tx, c) {
  const t = tileAt(tx.room.board, c.position);
  return t?.type === 'stop' && t.promptId === 'routeChoice' && !c.route;
}

/**
 * Turn epilogue for the current character: discharge / graduation, then the next life decision in order —
 * 진로 → 군 복무 → 취업 → 자동 입대 → 인생 갈림길 → 숨은 직업 → 프러포즈 (Stage 8). Opens at most one prompt.
 * @returns true when a prompt was opened (the turn waits for it)
 */
export function lifeStep(tx, c) {
  if (!c) return false;
  const data = tx.data;
  ensureLife(c, data);
  const mil = c.military;
  const mcfg = data.balance.military;
  // discharge / graduation also for a character that just reached the goal on its last service / school spin
  if (mil.status === 'serving' && mil.turnsLeft <= 0) endMilitary(tx, c);
  if (c.school && c.school.turnsLeft <= 0 && c.military.status !== 'serving') graduate(tx, c);
  if (c.finished) return false;
  if (!inJobEra(data, c)) return false;
  if (!c.careerDone) {
    if (c.examResult == null) c.careerDone = true;
    else if (openCareer(tx, c)) return true;
  }
  const body = bodyOf(c);
  const mandatory = (mcfg.mandatory ?? []).includes(body);
  if (c.military.status === 'none' && !c.military.deferred) {
    if (mandatory) {
      if (c.school) {
        openPrompt(tx, 'military', c, { mode: 'mandatory' });
        return true;
      }
    } else if ((mcfg.volunteer ?? []).includes(body) && (c.stats.str ?? 0) >= (mcfg.volunteerMinStr ?? 0)) {
      openPrompt(tx, 'military', c, { mode: 'volunteer' });
      return true;
    } else c.military.status = 'exempt';
  }
  if (!c.job && !c.school && c.military.status !== 'serving') {
    const after = c.education !== 'none' && c.jobHistory.length === 0 && c.careerChoice === 'college' ? 'college' : c.military.status === 'done' && mandatory ? 'military' : null;
    if (offerJob(tx, c, { after })) return true;
  }
  if (c.military.status === 'none' && mandatory && !c.school) startMilitary(tx, c);
  if (atRouteStop(tx, c)) {
    openPrompt(tx, 'routeChoice', c);
    return true;
  }
  const unlocked = checkHiddenUnlocks(tx, c);
  if (unlocked.length) {
    openPrompt(tx, 'hiddenJobOffer', c, { jobId: unlocked[0] });
    return true;
  }
  return proposeStep(tx, c); // Stage 8: a ripe relationship → one 프러포즈 per era
}

/** 진로 prompt (or apply the only possible choice directly). @returns true when a prompt opened */
function openCareer(tx, c) {
  const options = careerOptions(tx, c);
  if (options.length === 1) {
    applyCareer(tx, c, options[0].id);
    return !!tx.room.turn.pending;
  }
  openPrompt(tx, 'career', c, { options });
  return true;
}

function tuitionOf(tx, c, tier) {
  return round5((tx.data.balance.career.tuition?.[tier] ?? 0) * effectsFor(tx, c).tuitionMult);
}

function careerOptions(tx, c) {
  const out = [];
  const tier = c.examResult === 'elite' ? 'elite' : c.examResult === 'college' ? 'college' : null;
  if (tier) {
    const fee = tuitionOf(tx, c, tier);
    out.push({
      id: 'college',
      label: tier === 'elite' ? '🎓 명문대 진학' : '🎓 대학 진학',
      icon: '🎓',
      desc: `학자금 대출 ${won(fee)} · 졸업하면 지력 +1, 좋은 직업 후보`,
    });
  }
  out.push({ id: 'job', label: '💼 바로 취업', icon: '💼', desc: '빚 없이 바로 사회로!' });
  if (!c.retook && c.examResult !== 'elite') {
    out.push({ id: 'retake', label: '📖 재수', icon: '📖', desc: '한 턴 쉬고 수능 재도전 · 붙으면 바로 입학 (한 번만)' });
  }
  return out;
}

function applyCareer(tx, c, choice) {
  const cfg = tx.data.balance.career;
  if (choice === 'retake' && !c.retook) {
    c.retook = true;
    c.skipTurns = (c.skipTurns ?? 0) + (cfg.retakeSkipTurns ?? 1);
    c.careerChoice = 'retake';
    addLog(tx, `📖 ${josa(c.name, '은/는')} 재수를 결심했다! 1년 동안 독서실로…`, { tone: 'info', charId: c.id, emotion: 'sweat' });
    openPrompt(tx, 'exam', c, { retake: true });
    return;
  }
  c.careerDone = true;
  if (choice === 'college' && (c.examResult === 'elite' || c.examResult === 'college')) {
    const tier = c.examResult;
    c.careerChoice = 'college';
    c.school = { tier, turnsLeft: cfg.collegeTurns ?? 1 };
    const fee = tuitionOf(tx, c, tier);
    addDebt(tx, c, fee, 'tuition', { tone: 'bad', emotion: 'sweat' });
    addLog(tx, `🎓 ${c.name} ${tier === 'elite' ? '명문대' : '대학'} 입학! (학자금 대출 ${won(fee)})`, { tone: 'good', charId: c.id, emotion: 'joy' });
    return;
  }
  c.careerChoice = 'job';
  addLog(tx, `💼 ${josa(c.name, '은/는')} 바로 사회에 뛰어들기로 했다!`, { tone: 'career', charId: c.id, emotion: 'joy' });
}

// ---------- prompts ----------

registerPrompts({
  /** Kids-era habit tile: 학원 → 지력, 태권도 → 체력, 피아노·미술 → 매력, 게임·뽑기 → 운 (money ±). */
  habit: {
    resultCutin: 'auto',
    build(tx, c) {
      const cfg = tx.data.balance.habits;
      const era = c.era;
      const scale = (cfg.costScale?.[era] ?? 1) * effectsFor(tx, c).habitCostMult;
      const labels = cfg.labels?.[era] ?? cfg.labels?.elem ?? {};
      // A habit never pushes a kid into debt: a fee is capped at the cash on hand (the rest = 부모님 찬스, so a
      // broke kid's lessons are free) and the 뽑기 loss is capped too.
      const cash = Math.max(0, c.money ?? 0);
      const options = cfg.options.map((o) => {
        const gain = `${statName(tx.data, o.stat)} +${o.gain}`;
        const fee = o.cost ? round5(o.cost * scale) : 0;
        const pay = Math.min(fee, cash);
        const money = o.money
          ? ` · 용돈 ${won(-Math.min(cash, -round5(o.money[0] * scale)))}~+${won(round5(o.money[1] * scale))}`
          : o.cost
            ? pay <= 0
              ? ' · 무료 (부모님 찬스)'
              : pay < fee
                ? ` · ${won(pay)} (나머지는 부모님 찬스)`
                : ` · ${won(fee)}`
            : '';
        return { id: o.id, label: `${o.icon} ${labels[o.id] ?? o.id}`, icon: o.icon, stat: o.stat, desc: `${gain}${money}`, ...(o.cost ? { cost: pay, ...(pay < fee ? { basePrice: fee } : {}) } : {}) };
      });
      return {
        forCharacterIds: [c.id],
        title: '🎒 습관 만들기',
        text: `${josa(c.name, '은/는')} 요즘 뭘 하면서 지낼까?`,
        options,
        defaultOptionId: options[0].id,
        context: { era, scale },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const cfg = tx.data.balance.habits;
      const opt = cfg.options.find((o) => o.id === p.answers[c.id]) ?? cfg.options[0];
      const scale = p.context?.scale ?? 1;
      const gain = opt.gain + (tx.rng.next() < (cfg.bonusChance ?? 0) ? 1 : 0);
      const label = (cfg.labels?.[p.context?.era] ?? {})[opt.id] ?? opt.id;
      const changes = addStats(tx, c, { [opt.stat]: gain }, 'habit', { habit: opt.id });
      let money = 0;
      if (opt.money) money = round5(tx.rng.int(opt.money[0], opt.money[1]) * scale);
      else if (opt.cost) money = -round5(opt.cost * scale);
      if (money < 0) money = -Math.min(-money, Math.max(0, c.money ?? 0)); // never into debt (부모님 찬스)
      if (money) changeMoney(tx, c, money, 'habit', { emotion: money > 0 ? 'joy' : 'sweat', tone: money > 0 ? 'good' : 'bad' });
      const statPart = changes.length ? statText(tx.data, changes) : '능력치는 이미 최고';
      addLog(tx, `${opt.icon} ${c.name}: ${label}! ${statPart}${money ? ` (${money > 0 ? '+' : ''}${won(money)})` : ''}`, {
        tone: 'good',
        charId: c.id,
        emotion: 'joy',
      });
      return { result: opt.id, stat: opt.stat };
    },
  },

  /** 수능: 차근차근 / 찍기 → examResult elite | college | fail (지력·운·선택·뉴스·재수). */
  exam: {
    resultCutin: true, // promptResolved {result} → result cut-in
    build(tx, c, { retake = false } = {}) {
      const eff = effectsFor(tx, c);
      const study = examChances(c, 'study', tx.data, { examBonus: eff.examBonus, retake });
      const guess = examChances(c, 'guess', tx.data, { examBonus: eff.examBonus, retake });
      const pct = (x) => Math.round(x * 100);
      return {
        forCharacterIds: [c.id],
        title: retake ? '📝 재수 수능' : '📝 수능 날',
        text: `${josa(c.name, '이/가')} ${retake ? '1년 만에 다시 ' : ''}수능 시험장에 들어섰다. 어떻게 풀까?`,
        options: [
          { id: 'study', label: '차근차근 푼다', icon: '✏️', desc: `지력 승부 · 합격 약 ${pct(study.college)}% (명문대 ${pct(study.elite)}%)` },
          { id: 'guess', label: '감으로 찍는다', icon: '🎯', desc: `운 승부 · 합격 약 ${pct(guess.college)}% (명문대 ${pct(guess.elite)}%)` },
        ],
        defaultOptionId: 'study',
        context: { retake },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const choice = p.answers[c.id] === 'guess' ? 'guess' : 'study';
      const eff = effectsFor(tx, c);
      const chances = examChances(c, choice, tx.data, { examBonus: eff.examBonus, retake: !!p.context?.retake });
      const result = examOutcome(chances, tx.rng.next());
      // a 재수 keeps the better of the two results
      const rank = { fail: 0, college: 1, elite: 2 };
      c.examResult = c.examResult && rank[c.examResult] > rank[result] ? c.examResult : result;
      const reward = tx.data.balance.exam.reward?.[result] ?? 0;
      if (reward) changeMoney(tx, c, reward, 'exam', { emotion: 'joy', tone: 'good' });
      if (result === 'fail') addLog(tx, `😵 ${c.name}, 수능이 생각보다 어려웠다… (${EXAM_LABEL.fail})`, { tone: 'bad', charId: c.id, emotion: 'sweat' });
      else addLog(tx, `🎉 ${c.name} 수능 대박! ${EXAM_LABEL[result]}${reward ? ` · 장학금 ${won(reward)}` : ''}`, { tone: 'good', charId: c.id, emotion: 'joy' });
      // 재수 = for college: a pass (this year or last) enrolls at once, a second fail goes straight to work
      if (p.context?.retake) applyCareer(tx, c, c.examResult === 'fail' ? 'job' : 'college');
      return { result };
    },
  },

  /** 진로 (청년 진입): 대학 진학 / 바로 취업 / 재수 (한 번만). */
  career: {
    build(tx, c, { options }) {
      const label = c.examResult ? EXAM_LABEL[c.examResult] : '';
      return {
        forCharacterIds: [c.id],
        title: '🧭 진로 선택',
        text: `수능 결과는 「${label}」! ${josa(c.name, '은/는')} 어떤 길로 갈까?`,
        options,
        defaultOptionId: options[0].id,
        context: { examResult: c.examResult },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      applyCareer(tx, c, p.answers[c.id]);
    },
  },

  /** 군 복무: mandatory (대학생: 지금 / 졸업 후 한 번 연기) · volunteer (자원 입대 / 안 함). */
  military: {
    build(tx, c, { mode }) {
      const m = tx.data.balance.military;
      const desc = `룰렛 ${m.turns}번 절반 이동 · 체력 +${m.strGain}${m.pay ? ` · 군 월급 ${won(m.pay)}` : ''}`;
      const options =
        mode === 'volunteer'
          ? [
              { id: 'volunteer', label: '🪖 자원 입대', icon: '🪖', desc },
              { id: 'skip', label: '🙅 입대하지 않기', icon: '🙅', desc: '지금처럼 인생을 이어가요' },
            ]
          : [
              { id: 'now', label: '🪖 지금 입대 (휴학)', icon: '🪖', desc },
              { id: 'later', label: '🎓 졸업 후 입대', icon: '🎓', desc: '대학을 먼저 마쳐요 (연기는 한 번만)' },
            ];
      return {
        forCharacterIds: [c.id],
        title: mode === 'volunteer' ? '🪖 자원 입대' : '🪖 입영 통지서',
        text: mode === 'volunteer' ? `체력이 좋은 ${c.name}, 자원 입대할까요?` : `${c.name}에게 입영 통지서가 왔다! 언제 갈까?`,
        options,
        defaultOptionId: mode === 'volunteer' ? 'skip' : 'now',
        context: { mode },
      };
    },
    resolve(tx, p) {
      const c = charById(tx.room, p.charId);
      const a = p.answers[c.id];
      if (a === 'now' || a === 'volunteer') startMilitary(tx, c);
      else if (a === 'later') {
        c.military.deferred = true;
        addLog(tx, `🎓 ${josa(c.name, '은/는')} 졸업 후에 입대하기로 했다`, { charId: c.id });
      } else {
        c.military.status = 'exempt';
        addLog(tx, `🙅 ${josa(c.name, '은/는')} 입대하지 않기로 했다`, { charId: c.id });
      }
    },
  },
});

/** Habit tile (kids eras) → habit prompt. */
export const resolveHabitTile = (tx, c) => openPrompt(tx, 'habit', c);

