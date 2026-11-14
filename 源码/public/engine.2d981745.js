// engine.js —— 纯函数计算引擎（浏览器与 Node 共用，无副作用）
// 设计原则：公式负责“算得对”，AI 只负责“把现实转成结构化输入”。

export const KCAL_PER_KG_FAT = 7700;

export const ACTIVITY_FACTORS = {
  sedentary: { value: 1.2, label: '几乎不动（每天<3000步）' },
  light: { value: 1.375, label: '轻度活动（每天走课、偶尔运动）' },
  moderate: { value: 1.55, label: '中度活动（每周运动3–5次）' },
  active: { value: 1.725, label: '高强度（每周训练6次以上）' },
};

// 身体状态 → 缺口与训练量的修正系数
export const STATE_FACTORS = {
  normal: { deficit: 1.0, training: 1.0, label: '正常', note: '按计划执行' },
  tired: { deficit: 0.6, training: 0.6, label: '熬夜困倦', note: '缩小缺口、降低强度，先补觉' },
  unwell: { deficit: 0.4, training: 0.2, label: '疲惫不适', note: '缺口收到最小，今天以恢复为主' },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/** Mifflin-St Jeor 基础代谢 */
export function bmr({ sex, age, heightCm, weightKg }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/** 每日总消耗 */
export function tdee(bmrValue, activity = 'light') {
  const f = (ACTIVITY_FACTORS[activity] || ACTIVITY_FACTORS.light).value;
  return bmrValue * f;
}

export function bmi({ heightCm, weightKg }) {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/**
 * 目标校验：这是产品的“安全阀”，也是最容易被评委追问的地方。
 * 返回 blocked（不允许）/ warnings（提醒）/ 建议方案
 */
export function validateGoal(input) {
  const { sex, age, heightCm, weightKg, targetWeightKg, targetDate } = input;
  const warnings = [];
  let blocked = false;

  const bmiValue = bmi({ heightCm, weightKg });
  const days = targetDate
    ? Math.max(1, Math.ceil((new Date(targetDate) - new Date()) / 86400000))
    : 0;

  if (bmiValue < 18.5) {
    blocked = true;
    warnings.push({
      level: 'danger',
      text: `当前 BMI ${round(bmiValue, 1)}，已低于 18.5。本产品不为此人群生成减脂方案，建议先咨询校医院或营养科。`,
    });
  }

  if (targetWeightKg >= weightKg) {
    blocked = true;
    warnings.push({ level: 'danger', text: '目标体重不低于当前体重，这不是一个减脂目标。' });
  }

  const loss = weightKg - targetWeightKg;
  const weeks = days > 0 ? days / 7 : 0;
  const ratePerWeek = weeks > 0 ? loss / weeks : 0;
  const maxRate = weightKg * 0.01; // 每周不超过体重的 1%

  if (weeks > 0 && ratePerWeek > maxRate) {
    const safeWeeks = loss / maxRate;
    const safeDate = new Date(Date.now() + safeWeeks * 7 * 86400000);
    warnings.push({
      level: 'warn',
      text: `按你选的日期，需要每周减 ${round(ratePerWeek, 2)} kg，超过安全上限 ${round(maxRate, 2)} kg/周（体重的 1%）。`,
      suggest: {
        text: `同样减 ${round(loss, 1)} kg，健康节奏约需 ${round(safeWeeks, 1)} 周，建议目标日期改为 ${safeDate.toISOString().slice(0, 10)}。`,
        suggestedDate: safeDate.toISOString().slice(0, 10),
      },
    });
  }

  if (loss / weightKg > 0.15) {
    warnings.push({
      level: 'warn',
      text: `本次目标要减掉当前体重的 ${round((loss / weightKg) * 100, 0)}%。幅度较大，建议拆成 2–3 个阶段，每阶段 3–5 kg。`,
    });
  }

  if (age < 18) {
    warnings.push({ level: 'warn', text: '未满 18 岁，处于生长发育期，不建议主动限制热量，请以运动与作息为主。' });
  }

  return {
    ok: !blocked,
    blocked,
    bmi: round(bmiValue, 1),
    days,
    weeks: round(weeks, 1),
    loss: round(loss, 1),
    ratePerWeek: round(ratePerWeek, 2),
    maxRatePerWeek: round(maxRate, 2),
    warnings,
  };
}

/**
 * 每日预算：缺口由“目标需要的速度”和“安全上限”双向夹住，
 * 再按当天身体状态打折。
 */
export function dailyBudget({ sex, age, heightCm, weightKg, targetWeightKg, targetDate, activity = 'light', state = 'normal' }) {
  const bmrValue = bmr({ sex, age, heightCm, weightKg });
  const total = tdee(bmrValue, activity);
  const goal = validateGoal({ sex, age, heightCm, weightKg, targetWeightKg, targetDate });

  const days = Math.max(1, goal.days);
  const needPerDay = ((weightKg - targetWeightKg) * KCAL_PER_KG_FAT) / days;

  // 缺口限制在 TDEE 的 10%–22%，且不超过 550 kcal
  let deficit = clamp(needPerDay, total * 0.1, Math.min(total * 0.22, 550));
  const stateFactor = (STATE_FACTORS[state] || STATE_FACTORS.normal).deficit;
  deficit = deficit * stateFactor;

  // 硬下限：不低于基础代谢的 1.1 倍
  const floor = Math.max(bmrValue * 1.1, sex === 'male' ? 1500 : 1200);
  let targetKcal = total - deficit;
  let floorHit = false;
  if (targetKcal < floor) {
    targetKcal = floor;
    deficit = total - floor;
    floorHit = true;
  }
  if (deficit < 0) deficit = 0;

  // 蛋白质按体重给，脂肪占 25%，其余给碳水
  const protein = Math.round(weightKg * 1.6);
  const fat = Math.round((targetKcal * 0.25) / 9);
  const carb = Math.max(0, Math.round((targetKcal - protein * 4 - fat * 9) / 4));

  return {
    bmr: Math.round(bmrValue),
    tdee: Math.round(total),
    targetKcal: Math.round(targetKcal),
    deficit: Math.round(deficit),
    protein,
    fat,
    carb,
    floorHit,
    state,
    stateNote: (STATE_FACTORS[state] || STATE_FACTORS.normal).note,
    goal,
  };
}

/** 三餐热量分配 */
export const MEAL_SPLIT = { breakfast: 0.28, lunch: 0.4, dinner: 0.32 };
export const MEAL_LABEL = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };

/**
 * 食堂搭配优化：在用户当天能买到的菜里，找最接近目标的组合。
 * 穷举 1–3 个菜的组合，按热量/蛋白/脂肪加权误差打分，主食最多一个。
 */
export function optimizeMeals(dishes, budget) {
  const out = { meals: {}, totals: { kcal: 0, protein: 0, fat: 0, carb: 0 }, feasible: true };

  for (const key of Object.keys(MEAL_SPLIT)) {
    const target = {
      kcal: budget.targetKcal * MEAL_SPLIT[key],
      protein: budget.protein * MEAL_SPLIT[key],
      fat: budget.fat * MEAL_SPLIT[key],
      carb: budget.carb * MEAL_SPLIT[key],
    };

    const pool = dishes
      .filter((d) => !d.meals || d.meals.includes(key))
      .filter((d) => Number(d.kcal) > 0)
      .slice(0, 16);

    if (!pool.length) {
      out.meals[key] = { items: [], target, sum: { kcal: 0, protein: 0, fat: 0, carb: 0 }, score: null, empty: true };
      out.feasible = false;
      continue;
    }

    let best = null;
    const consider = (combo) => {
      const sum = combo.reduce(
        (a, d) => ({
          kcal: a.kcal + Number(d.kcal || 0),
          protein: a.protein + Number(d.protein || 0),
          fat: a.fat + Number(d.fat || 0),
          carb: a.carb + Number(d.carb || 0),
        }),
        { kcal: 0, protein: 0, fat: 0, carb: 0 }
      );
      const kcalErr = Math.abs(sum.kcal - target.kcal) / Math.max(1, target.kcal);
      const proteinErr = Math.max(0, target.protein - sum.protein) / Math.max(1, target.protein);
      const fatErr = Math.max(0, sum.fat - target.fat) / Math.max(1, target.fat);
      const staples = combo.filter((d) => d.category === 'staple').length;
      let score = 0.45 * kcalErr + 0.35 * proteinErr + 0.2 * fatErr;
      if (staples > 1) score += 0.5;
      if (!best || score < best.score) best = { items: combo, sum, score, target };
    };

    for (let i = 0; i < pool.length; i++) {
      consider([pool[i]]);
      for (let j = i + 1; j < pool.length; j++) {
        consider([pool[i], pool[j]]);
        for (let k = j + 1; k < pool.length; k++) consider([pool[i], pool[j], pool[k]]);
      }
    }

    out.meals[key] = best;
    out.totals.kcal += best.sum.kcal;
    out.totals.protein += best.sum.protein;
    out.totals.fat += best.sum.fat;
    out.totals.carb += best.sum.carb;
  }

  for (const k of Object.keys(out.totals)) out.totals[k] = Math.round(out.totals[k]);
  return out;
}

/**
 * 动作池：按强度和类型分组。每次按“日期 + 状态”做确定性轮换，
 * 同一个输入永远得到同一套动作（可复现），但不同天不会重复。
 */
export const EXERCISE_POOL = {
  warm: ['原地高抬腿 40 秒', '肩颈绕环 20 次', '髋关节绕环 15 次', '开合跳 30 秒', '原地小跑 60 秒'],
  low: ['靠墙静蹲 3 组 × 30 秒', '跪姿俯卧撑 10 次 × 3 组', '臀桥 15 次 × 3 组', '站姿提踵 20 次 × 3 组', '侧卧抬腿 15 次 × 2 组'],
  mid: ['深蹲 15 次 × 3 组', '箭步蹲 12 次 × 3 组', '俯卧撑 10 次 × 3 组', '开合跳 40 秒 × 3 组', '登山跑 30 秒 × 3 组', '波比跳 8 次 × 3 组'],
  high: ['波比跳 12 次 × 5 组', '深蹲跳 10 次 × 4 组', '俯卧撑 15 次 × 4 组', '登山跑 40 秒 × 4 组', '箭步跳 12 次 × 3 组', '开合跳 60 秒 × 4 组'],
  core: ['平板支撑 40 秒 × 3 组', '死虫式 12 次 × 3 组', '俄罗斯转体 20 次 × 3 组', '侧平板 30 秒 × 2 组'],
  cool: ['大腿前侧拉伸 45 秒', '腘绳肌拉伸 45 秒', '胸椎旋转 10 次', '婴儿式 60 秒', '靠墙放松 2 分钟'],
  recover: ['靠墙静蹲 2 组 × 20 秒', '肩颈拉伸 5 分钟', '睡前腹式呼吸 3 分钟', '泡沫轴放松大腿 3 分钟'],
};

/**
 * 当天训练方案：由身体状态、可用时长、连续训练天数共同决定动作组合。
 * seed 默认取当天日期，保证同一天多次打开结果一致。
 */
export function trainingPlan({ state = 'normal', minutes = 30, streak = 0, seed = null, equipment = 'none' }) {
  const f = (STATE_FACTORS[state] || STATE_FACTORS.normal).training;
  const effMinutes = Math.max(8, Math.round(minutes * f));
  const day = seed ?? Math.floor(Date.now() / 86400000) % 9973;

  const take = (pool, count, offset) => {
    const out = [];
    for (let i = 0; i < count && i < pool.length; i++) out.push(pool[(day + offset + i * 3) % pool.length]);
    return out;
  };

  let intensity, burnRate, items, tier;
  if (state === 'unwell') {
    intensity = '恢复';
    burnRate = 2.5;
    tier = 'recover';
    items = [...take(EXERCISE_POOL.recover, 2, 0), take(EXERCISE_POOL.cool, 2, 5)[0]];
  } else if (effMinutes < 20) {
    intensity = '低';
    burnRate = 3.5;
    tier = 'low';
    items = [...take(EXERCISE_POOL.low, 3, 0), take(EXERCISE_POOL.cool, 1, 7)[0]];
  } else if (effMinutes < 40) {
    intensity = '中';
    burnRate = 5;
    tier = 'mid';
    items = [
      take(EXERCISE_POOL.warm, 1, 1)[0],
      ...take(EXERCISE_POOL.mid, 3, 2),
      take(EXERCISE_POOL.core, 1, 4)[0],
      take(EXERCISE_POOL.cool, 1, 7)[0],
    ];
  } else {
    intensity = '中高';
    burnRate = 6.5;
    tier = 'high';
    items = [
      take(EXERCISE_POOL.warm, 1, 1)[0],
      ...take(EXERCISE_POOL.high, 4, 3),
      take(EXERCISE_POOL.core, 1, 4)[0],
      take(EXERCISE_POOL.cool, 1, 8)[0],
    ];
  }

  const notes = [];
  if (streak >= 6 && state === 'normal') {
    notes.push('已连续训练 6 天，今天建议改为恢复日（只做拉伸和放松）。');
  }
  if (equipment === 'none') {
    notes.push('全部动作无需器械，宿舍 2 平米可做；跳跃类若怕吵楼下，换成静音版（去掉腾空）。');
  }

  return {
    level: intensity,
    tier,
    minutes: effMinutes,
    burnKcal: Math.round(effMinutes * burnRate),
    items,
    notes,
    note: (STATE_FACTORS[state] || STATE_FACTORS.normal).note,
  };
}

/**
 * 每日饮食打分：40 热量 / 30 蛋白 / 15 脂肪 / 15 记录完整度
 * 只记录了一两餐时，按已记录餐次折算目标，避免"没吃完就低分"误导用户。
 */
export function scoreDay(actual, budget, loggedMeals = 3) {
  const partial = loggedMeals < 3;
  const ratio = partial ? loggedMeals / 3 : 1;
  const expKcal = budget.targetKcal * ratio;
  const expProtein = budget.protein * ratio;
  const expFat = budget.fat * ratio;

  const parts = [];

  const kcalRatio = actual.kcal / expKcal;
  let calScore;
  if (kcalRatio >= 0.92 && kcalRatio <= 1.08) calScore = 100;
  else calScore = Math.max(0, 100 - (Math.abs(kcalRatio - 1) - 0.08) * 400);
  parts.push({ name: '热量', score: Math.round(calScore), weight: 0.4, detail: `${Math.round(actual.kcal)} / ${Math.round(expKcal)} kcal` });

  const pRatio = actual.protein / Math.max(1, expProtein);
  const pScore = pRatio >= 0.95 ? 100 : Math.max(0, (pRatio / 0.95) * 100);
  parts.push({ name: '蛋白质', score: Math.round(pScore), weight: 0.3, detail: `${Math.round(actual.protein)} / ${Math.round(expProtein)} g` });

  const fRatio = actual.fat / Math.max(1, expFat);
  const fScore = fRatio <= 1.1 ? 100 : Math.max(0, 100 - (fRatio - 1.1) * 200);
  parts.push({ name: '脂肪', score: Math.round(fScore), weight: 0.15, detail: `${Math.round(actual.fat)} / ${Math.round(expFat)} g` });

  const logScore = Math.min(100, (loggedMeals / 3) * 100);
  parts.push({ name: '记录完整度', score: Math.round(logScore), weight: 0.15, detail: `${loggedMeals} / 3 餐` });

  const total = Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0));
  const tips = [];
  if (!partial && calScore < 70 && kcalRatio > 1.08) tips.push('今天超出预算，明天早餐可以简单一点，不用补救式节食。');
  if (!partial && calScore < 70 && kcalRatio < 0.92) tips.push('今天吃得太少，长期会掉肌肉和代谢，加一份蛋白质。');
  if (pScore < 80) tips.push(`蛋白质还差约 ${Math.max(0, Math.round(expProtein - actual.protein))} g，加一个鸡蛋或一份鸡胸就能补上。`);
  if (fScore < 80) tips.push('脂肪偏高，明天点菜时避开油炸和红烧，选清炒或蒸的。');
  if (partial) tips.unshift(`目前只记录了 ${loggedMeals} 餐，分数按已记录部分折算，补全后更准。`);

  return { total, parts, tips, partial };
}

/** 汇总一餐的实际摄入 */
export function sumIntake(items) {
  return items.reduce(
    (a, d) => ({
      kcal: a.kcal + Number(d.kcal || 0),
      protein: a.protein + Number(d.protein || 0),
      fat: a.fat + Number(d.fat || 0),
      carb: a.carb + Number(d.carb || 0),
    }),
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
}

/** 强度 → 每分钟消耗（kcal），供 AI 方案估算 */
export const TRAINING_RATE = { 恢复: 2.5, 低: 3.5, 中: 5, 中高: 6.5 };

const BAD_WORDS = ['跳绳', '杠铃', '哑铃', '跑步机', '引体向上', '器械'];

/**
 * 校验 AI 给的训练方案。不合规一律返回 null，由调用方回落到本地方案。
 * 这不是不信任 AI，是防止模型偶尔编出宿舍做不到的动作。
 */
export function validateAiPlan(raw, wantMinutes = 30) {
  if (!raw || typeof raw !== 'object') return null;
  const level = String(raw.level || '').trim();
  if (!Object.prototype.hasOwnProperty.call(TRAINING_RATE, level)) return null;

  const blocksIn = Array.isArray(raw.blocks) ? raw.blocks : [];
  if (blocksIn.length < 2 || blocksIn.length > 5) return null;

  const blocks = [];
  let count = 0;
  for (const b of blocksIn) {
    const title = String(b?.title || '').trim().slice(0, 8) || '训练';
    const items = (Array.isArray(b?.items) ? b.items : [])
      .map((x) => String(x || '').trim())
      .filter((x) => x.length >= 2 && x.length <= 40)
      .filter((x) => !BAD_WORDS.some((w) => x.includes(w)));
    if (!items.length) continue;
    blocks.push({ title, items: items.slice(0, 6) });
    count += items.length;
  }
  if (count < 3 || count > 16) return null;
  if (blocks.length < 2) return null;

  let totalMinutes = Number(raw.totalMinutes);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) totalMinutes = wantMinutes;
  if (totalMinutes < wantMinutes * 0.6 || totalMinutes > wantMinutes * 1.6) totalMinutes = wantMinutes;
  totalMinutes = Math.round(totalMinutes);

  return {
    level,
    totalMinutes,
    blocks,
    why: String(raw.why || '').slice(0, 90),
    source: 'ai',
  };
}

const MEAL_KEYS = ['breakfast', 'lunch', 'dinner'];

/**
 * 校验 AI 给的配餐：菜必须真的在今天的菜单里，份量夹在 0.5–2 之间，
 * 热量与蛋白质达标才采用。不达标返回 null，由调用方回落到规则搭配。
 */
export function validateAiMeals(raw, dishes, target) {
  if (!raw || !raw.meals || typeof raw.meals !== 'object') return null;

  const byName = new Map();
  for (const d of dishes) byName.set(String(d.name).trim(), d);
  const find = (name) => {
    const n = String(name || '').trim();
    if (byName.has(n)) return byName.get(n);
    for (const [k, v] of byName) if (k.includes(n) || n.includes(k)) return v;
    return null;
  };

  const meals = {};
  let totalKcal = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let picked = 0;

  for (const key of MEAL_KEYS) {
    const list = Array.isArray(raw.meals[key]) ? raw.meals[key] : [];
    const items = [];
    for (const it of list.slice(0, 5)) {
      const d = find(it?.name);
      if (!d) continue;
      let portion = Number(it?.portion);
      if (!Number.isFinite(portion) || portion <= 0) portion = 1;
      portion = Math.min(2, Math.max(0.5, Math.round(portion * 2) / 2));
      items.push({
        id: d.id,
        name: d.name,
        portion,
        kcal: Math.round(Number(d.kcal) * portion),
        protein: Math.round(Number(d.protein) * portion),
        fat: Math.round(Number(d.fat) * portion),
      });
      totalKcal += Number(d.kcal) * portion;
      totalProtein += Number(d.protein) * portion;
      totalFat += Number(d.fat) * portion;
      picked++;
    }
    if (items.length) meals[key] = items;
  }

  if (!picked || picked > 12) return null;
  if (Object.keys(meals).length < 2) return null;

  const tKcal = Number(target && target.kcal);
  const tProtein = Number(target && target.protein);
  if (!Number.isFinite(tKcal) || tKcal <= 0) return null; // 目标不明确就拒绝，避免 NaN 让校验失效

  const ratio = totalKcal / tKcal;
  if (ratio < 0.85 || ratio > 1.15) return null;
  if (Number.isFinite(tProtein) && tProtein > 0 && totalProtein < tProtein * 0.8) return null;

  return {
    meals,
    totals: { kcal: Math.round(totalKcal), protein: Math.round(totalProtein), fat: Math.round(totalFat) },
    why: String(raw.why || '').slice(0, 120),
    tips: (Array.isArray(raw.tips) ? raw.tips : []).slice(0, 2).map((t) => String(t).slice(0, 80)),
    source: 'ai',
  };
}

/** 菜单指纹：菜单变了，AI 配餐就作废 */
export function dishSignature(dishes) {
  return dishes.map((d) => String(d.name).trim()).sort().join('|');
}
