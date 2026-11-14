// health-common.js —— 特殊健康状况模块的公共工具
// 该模块与减脂模块完全独立：只读取登录 token 与自己的 localStorage 命名空间，
// 不引用 engine.js / app.js 的任何业务状态。

export const DISCLAIMER =
  '本内容仅为膳食、运动科普参考，不能替代医生、营养师、康复师方案，患有基础疾病请遵从医嘱，本工具不提供诊疗服务。';

export const TAG_META = {
  forbidden: { label: '禁食', emoji: '🔴', cls: 'tag-red' },
  limit: { label: '少吃', emoji: '🟡', cls: 'tag-yellow' },
  recommend: { label: '推荐', emoji: '🟢', cls: 'tag-green' },
};

const TOKEN_KEY = 'canteen-fit-token';

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

export const authHeaders = () => {
  const t = getToken();
  return t ? { Authorization: 'Bearer ' + t } : {};
};

/** 校验登录状态；未登录时显示 #authGate 并返回 null */
export async function getSessionUser() {
  let data = null;
  try {
    const r = await fetch('/api/auth/me', { headers: authHeaders() });
    data = await r.json();
  } catch {}
  if (data && data.user) {
    const shell = document.querySelector('.app-shell');
    if (shell) shell.hidden = false;
    return data.user;
  }
  showAuthGate();
  return null;
}

export function showAuthGate() {
  const gate = document.getElementById('authGate');
  const shell = document.querySelector('.app-shell');
  if (gate) gate.hidden = false;
  if (shell) shell.hidden = true;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function loadHealthData() {
  const r = await fetch('./health-data.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('健康数据加载失败');
  return r.json();
}

export function findCondition(data, id) {
  if (!data || !id) return null;
  const c = data.conditions && data.conditions[id];
  if (!c) return null;
  return { id, ...c };
}

export function findConditionMeta(data, id) {
  for (const cat of data.categories || []) {
    const item = (cat.conditions || []).find((x) => x.id === id);
    if (item) return { ...item, categoryName: cat.name, categoryId: cat.id };
  }
  return null;
}

export const ACTIVITY_FACTORS = {
  sedentary: { value: 1.2, label: '几乎不动（每天少于3000步）' },
  light: { value: 1.375, label: '轻度活动（走课、偶尔运动）' },
  moderate: { value: 1.55, label: '中度活动（每周运动3–5次）' },
  active: { value: 1.725, label: '高强度（每周训练6次以上）' },
};

const round50 = (v) => Math.max(0, Math.round(v / 50) * 50);

/**
 * 每日参考热量区间：Mifflin-St Jeor × 活动系数 × 病情系数。
 * 只用于膳食份量参考，不构成能量摄入建议。
 */
export function calorieRange(profile, condition) {
  const sex = profile.sex === 'male' ? 'male' : 'female';
  const age = Number(profile.age) || 20;
  const height = Number(profile.heightCm) || 165;
  const weight = Number(profile.weightKg) || 55;
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161);
  const af = (ACTIVITY_FACTORS[profile.activity] || ACTIVITY_FACTORS.light).value;
  const factor = Number(condition?.calorie?.factor) || 1;
  const pct = (Number(condition?.calorie?.rangePct) || 8) / 100;
  const center = bmr * af * factor;
  const floor = sex === 'male' ? 1500 : 1200;
  const low = Math.max(floor, round50(center * (1 - pct)));
  const high = Math.max(low + 100, round50(center * (1 + pct)));
  return {
    bmr: Math.round(bmr),
    center: Math.round(center),
    low,
    high,
    activityLabel: (ACTIVITY_FACTORS[profile.activity] || ACTIVITY_FACTORS.light).label,
    note: condition?.calorie?.note || '',
  };
}

export function tagOf(food) {
  return TAG_META[food?.tag] || TAG_META.limit;
}

export function searchFoods(condition, query, filter = 'all') {
  const q = String(query || '').trim().toLowerCase();
  const list = (condition?.foods || []).filter((f) => {
    if (filter !== 'all' && f.tag !== filter) return false;
    if (!q) return true;
    const hay = [f.name, f.note, ...(f.alias || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
  const order = { forbidden: 0, limit: 1, recommend: 2 };
  return list.sort((a, b) => (order[a.tag] ?? 9) - (order[b.tag] ?? 9) || a.name.localeCompare(b.name, 'zh-CN'));
}

export function foodCounts(condition) {
  const out = { forbidden: 0, limit: 0, recommend: 0 };
  for (const f of condition?.foods || []) if (out[f.tag] != null) out[f.tag]++;
  return out;
}

// ---------- 账号隔离的本地存储 ----------
export const setupKey = (uid) => `canteen-health-setup::${uid}`;
export const recordsKey = (uid, cid) => `canteen-health-records::${uid}::${cid}`;
export const mealsKey = (uid, cid) => `canteen-health-meals::${uid}::${cid}`;
export const chatKey = (uid, cid) => `canteen-health-chat::${uid}::${cid}`;

export function loadSetup(uid) {
  try {
    const raw = localStorage.getItem(setupKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSetup(uid, setup) {
  try {
    localStorage.setItem(setupKey(uid), JSON.stringify({ ...setup, updatedAt: Date.now() }));
  } catch {}
}

export function loadRecords(uid, cid) {
  try {
    const raw = localStorage.getItem(recordsKey(uid, cid));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveRecords(uid, cid, rows) {
  try {
    localStorage.setItem(recordsKey(uid, cid), JSON.stringify(rows.slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}

export function loadChat(uid, cid) {
  try {
    const raw = localStorage.getItem(chatKey(uid, cid));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function loadMeals(uid, cid) {
  try {
    const raw = localStorage.getItem(mealsKey(uid, cid));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((x) => x && x.date && x.meal && x.text).slice(-120)
      : [];
  } catch {
    return [];
  }
}

export function saveMeals(uid, cid, rows) {
  try {
    localStorage.setItem(mealsKey(uid, cid), JSON.stringify((rows || []).slice(-120)));
    return true;
  } catch {
    return false;
  }
}

export function saveChat(uid, cid, rows) {
  try {
    localStorage.setItem(chatKey(uid, cid), JSON.stringify(rows.slice(-30)));
    return true;
  } catch {
    return false;
  }
}

export function toast(msg) {
  let el = document.getElementById('healthToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'healthToast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}
