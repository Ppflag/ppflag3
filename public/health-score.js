// health-score.js —— 特殊健康状况：分餐打分与趋势（纯函数，无 DOM / 无网络）
export const MEAL_META = [
  { key: 'breakfast', name: '早餐', icon: '🌅', fallbackShare: 0.28 },
  { key: 'lunch', name: '午餐', icon: '☀️', fallbackShare: 0.4 },
  { key: 'dinner', name: '晚餐', icon: '🌙', fallbackShare: 0.32 },
];

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const round = (n) => Math.round(n);

export function toDateKey(value = Date.now()) {
  const d = new Date(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dateLabel(key) {
  const d = new Date(`${key}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function mealShare(condition, mealKey) {
  const meta = MEAL_META.find((m) => m.key === mealKey);
  const refs = Array.isArray(condition?.meals) ? condition.meals : [];
  const total = refs.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
  const ref = refs.find((m) => m.key === mealKey);
  if (total > 0 && ref && Number(ref.kcal) > 0) return Number(ref.kcal) / total;
  return meta?.fallbackShare || 0.33;
}

export function parseFoodTokens(text) {
  return String(text || '')
    .split(/[、,，;；+＋/／\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 20);
}

/** 用当前病种的食物库匹配用户输入的食材；每个词只取最具体的一条规则 */
export function matchFoods(condition, text) {
  const tokens = parseFoodTokens(text);
  const rules = Array.isArray(condition?.foods) ? condition.foods : [];
  const hits = [];
  const seen = new Set();
  for (const token of tokens) {
    let best = null;
    for (const f of rules) {
      const keys = [f.name, ...(f.alias || [])].filter((k) => String(k).length >= 2);
      for (const raw of keys) {
        const key = String(raw).toLowerCase();
        let rank = 9;
        if (token === key) rank = 0;
        else if (token.includes(key)) rank = 1;
        else if (key.includes(token)) rank = 2;
        if (rank === 9) continue;
        // 越具体的规则优先：完全匹配 > 输入包含规则名 > 规则名包含输入
        if (!best || rank < best.rank || (rank === best.rank && key.length > best.key.length)) {
          best = { rule: f, rank, key };
        }
      }
    }
    if (!best) continue;
    const id = `${best.rule.tag}::${best.rule.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push({
      name: best.rule.name,
      tag: best.rule.tag,
      amount: best.rule.amount || '',
      note: best.rule.note || '',
    });
  }
  return hits;
}

function kcalComponent(kcal, target) {
  if (!kcal) return { score: 55, ratio: 0, missing: true };
  const ratio = target > 0 ? kcal / target : 0;
  let score = 40;
  if (ratio >= 0.85 && ratio <= 1.15) score = 100;
  else if (ratio >= 0.7 && ratio <= 1.3) score = 85;
  else if (ratio >= 0.5 && ratio <= 1.5) score = 65;
  return { score, ratio, missing: false };
}

function balanceComponent(text) {
  const hasStaple = /饭|粥|面|粉|馒头|面包|燕麦|红薯|玉米|土豆|山药|杂粮|米线/.test(text);
  const hasProtein = /蛋|鱼|虾|鸡|鸭|肉|牛|羊|豆腐|豆干|豆浆|奶|酸奶|鸡胸|瘦肉/.test(text);
  const hasVeg = /菜|西兰花|菠菜|胡萝卜|番茄|黄瓜|冬瓜|南瓜|蘑菇|菌|海带|青椒|生菜|芹菜|萝卜/.test(text);
  return (hasStaple ? 35 : 0) + (hasProtein ? 40 : 0) + (hasVeg ? 25 : 0);
}

export function scoreMeal(condition, mealKey, entry, dailyTarget) {
  const text = String(entry?.text || '').trim();
  if (!text) return null;
  const kcal = Math.max(0, Number(entry?.kcal) || 0);
  const target = Math.max(1, Number(dailyTarget) || 0) * mealShare(condition, mealKey);
  const hits = matchFoods(condition, text);
  const forbidden = hits.filter((h) => h.tag === 'forbidden');
  const limit = hits.filter((h) => h.tag === 'limit');
  const recommend = hits.filter((h) => h.tag === 'recommend');

  const k = kcalComponent(kcal, target);
  let foodScore = 65;
  foodScore += Math.min(25, recommend.length * 8);
  foodScore -= Math.min(60, forbidden.length * 30);
  foodScore -= Math.min(24, limit.length * 8);
  foodScore = clamp(foodScore, 0, 100);

  const balanceScore = clamp(balanceComponent(text), 0, 100);
  const score = round(k.score * 0.4 + foodScore * 0.45 + balanceScore * 0.15);
  const grade = score >= 85 ? '优秀' : score >= 70 ? '良好' : score >= 60 ? '一般' : '需调整';

  const names = (list) => [...new Set(list.map((x) => x.name))].slice(0, 4).join('、');
  let comment = '';
  if (forbidden.length) {
    const alt = (condition.foods || []).find((f) => f.tag === 'recommend')?.name || '同类清淡食材';
    comment = `出现「${names(forbidden)}」等与当前病种规范不符的食物；建议下次替换为「${alt}」等更合适的选择。`;
  } else if (k.missing) {
    comment = '热量未填写，本次按食材搭配评分；补上热量后统计会更准确。';
  } else if (k.ratio > 1.3) {
    comment = `热量偏高，约超出本餐参考 ${Math.max(0, round(kcal - target))} kcal；下一餐注意清淡和份量。`;
  } else if (k.ratio < 0.6) {
    comment = '热量偏低，容易饿；可以补一份主食或优质蛋白，让这一餐更完整。';
  } else if (limit.length) {
    comment = `「${names(limit)}」属于少吃类，注意控制份量，并搭配蔬菜和优质蛋白。`;
  } else if (recommend.length >= 2) {
    comment = `搭配了「${names(recommend)}」等推荐食材，热量也在本餐参考范围内，保持这个结构。`;
  } else {
    comment = '整体搭配较稳；如果再加一份蔬菜或优质蛋白，结构会更完整。';
  }

  return {
    score,
    grade,
    comment,
    kcal,
    targetKcal: round(target),
    ratio: k.ratio,
    forbidden,
    limit,
    recommend,
    hits,
  };
}

export function scoreDay(condition, entries, dailyTarget, dateKey = toDateKey()) {
  const dayEntries = (entries || []).filter((e) => e.date === dateKey);
  const meals = MEAL_META.map((m) => {
    const entry = dayEntries.find((e) => e.meal === m.key) || null;
    return { ...m, entry, share: mealShare(condition, m.key) };
  });
  const covered = meals.filter((m) => m.entry).length;
  const totalKcal = meals.reduce((s, m) => s + (Number(m.entry?.kcal) || 0), 0);
  const weighted = meals.reduce((s, m) => s + (Number(m.entry?.score) || 0) * m.share, 0);
  // 未记录餐次不按 0 分拉低已记录部分；用已记录餐次的权重归一化，避免只吃一餐时分数失真
  const recordedShare = meals.reduce((s, m) => s + (m.entry ? m.share : 0), 0);
  const score = covered && recordedShare > 0 ? round(weighted / recordedShare) : 0;
  const grade = covered ? (score >= 85 ? '优秀' : score >= 70 ? '良好' : score >= 60 ? '一般' : '需调整') : '待记录';
  const allHits = meals.flatMap((m) => m.entry?.hits || []);
  const forbidden = [...new Set(allHits.filter((h) => h.tag === 'forbidden').map((h) => h.name))];
  const limit = [...new Set(allHits.filter((h) => h.tag === 'limit').map((h) => h.name))];
  const recommend = [...new Set(allHits.filter((h) => h.tag === 'recommend').map((h) => h.name))];

  let evaluation = '';
  if (!covered) {
    evaluation = '今天还没有分餐记录；记录早餐、午餐、晚餐后，会自动生成全天评价。';
  } else if (forbidden.length) {
    evaluation = `今天出现了「${forbidden.slice(0, 3).join('、')}」等与当前病种规范不符的食物；下一餐优先避开，并多选推荐食材。`;
  } else if (covered < 3) {
    evaluation = `已记录 ${covered}/3 餐，当前已记录部分得分 ${score} 分；补齐未记录餐次后，全天评价会更完整。`;
  } else if (totalKcal > dailyTarget * 1.1) {
    evaluation = `全天热量约 ${totalKcal} kcal，超过参考值约 ${round(totalKcal - dailyTarget)} kcal；明天注意主食和油脂份量。`;
  } else if (totalKcal < dailyTarget * 0.8) {
    evaluation = `全天热量约 ${totalKcal} kcal，低于参考区间；可以适当增加主食或优质蛋白，避免下一餐过饿。`;
  } else if (score >= 85) {
    evaluation = '三餐结构完整，推荐食材覆盖较好，热量接近参考区间；保持这个节奏。';
  } else if (score >= 70) {
    evaluation = '整体较稳；下一餐可以多补一份蔬菜或优质蛋白，并留意少吃类食物的份量。';
  } else {
    evaluation = '今天与当前病种饮食规范的匹配度偏低；从下一餐开始减少禁忌和少吃类食物，优先选推荐食材。';
  }

  return {
    date: dateKey,
    score,
    grade,
    evaluation,
    covered,
    totalKcal,
    target: round(dailyTarget),
    meals,
    forbidden,
    limit,
    recommend,
  };
}

export function trendData(condition, entries, dailyTarget, days = 7) {
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = toDateKey(d);
    const day = scoreDay(condition, entries, dailyTarget, key);
    out.push({
      date: key,
      label: i === 0 ? '今天' : dateLabel(key),
      score: day.covered ? day.score : null,
      covered: day.covered,
    });
  }
  return out;
}
