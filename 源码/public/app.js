// app.js —— 前端逻辑（原生 ES Module，无框架）
import * as E from './engine.js';

let KEY = 'canteen-fit-v1';
const TOKEN_KEY = 'canteen-fit-token';
const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};
const setToken = (t) => {
  try {
    t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
  } catch {}
};
const authHeaders = () => {
  const t = getToken();
  return t ? { Authorization: 'Bearer ' + t } : {};
};
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('zh-CN');

const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const weekdayOf = (dateStr) => '日一二三四五六'[new Date(dateStr + 'T00:00:00').getDay()];
const freshLog = (date) => ({ date, meals: { breakfast: [], lunch: [], dinner: [] }, trainingDone: false });

/**
 * 把当前菜单存到当前日期，再载入目标日期的菜单。
 * 目标日期还没有菜单时，沿用上一天的（食堂窗口一周不变，少操作）。
 * 返回是否发生了"沿用"。
 */
/** 删掉所有"晚于今天"的记录：那是演示推进日期造出来的，不该留在真实历史里 */
function dropFutureData(today) {
  let removed = 0;
  if (Array.isArray(S.history)) {
    const before = S.history.length;
    S.history = S.history.filter((h) => !h.date || h.date <= today);
    removed += before - S.history.length;
  }
  for (const key of ['logs', 'plans', 'menus']) {
    const obj = S[key];
    if (!obj) continue;
    for (const d of Object.keys(obj)) {
      if (d > today) {
        delete obj[d];
        removed++;
      }
    }
  }
  return removed;
}

function switchDayTo(nextDay) {
  if (!S.menus) S.menus = {};
  if (!S.logs) S.logs = {};
  if (!S.mealPlans) S.mealPlans = {};

  const prev = S.dishes || [];
  S.menus[S.day] = prev;

  // 把当前这天的打卡存档，切回来时能原样恢复
  if (S.log) S.logs[S.day] = JSON.parse(JSON.stringify(S.log));

  S.day = nextDay;
  const saved = S.logs[S.day];
  S.log = saved ? JSON.parse(JSON.stringify(saved)) : freshLog(S.day);

  let inherited = false;
  if (!S.menus[S.day]) {
    S.menus[S.day] = prev.map((d) => ({ ...d }));
    inherited = prev.length > 0;
  }
  S.dishes = S.menus[S.day];
  optimizeCache = null;
  dishExpanded = false;
  return inherited;
}

const DEFAULT = () => ({
  profile: null,
  state: 'normal',
  minutes: 30,
  streak: 0,
  dishes: [],
  day: todayStr(),
  menus: {},
  log: freshLog(todayStr()),
  history: [],
  chats: {}, // { 'YYYY-MM-DD': [消息] }
  plans: {}, // { 'YYYY-MM-DD': AI 生成的训练方案 }
  logs: {}, // { 'YYYY-MM-DD': 当天的打卡 }
  mealPlans: {}, // { 'YYYY-MM-DD': AI 配餐 }
});

let S = DEFAULT();
let optimizeCache = null;
let dishExpanded = false;
let heroLastValue = 0;
let logPicker = null; // {meal, mode:'manual'|'pick'}

// ---------------- 持久化 ----------------
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) S = { ...DEFAULT(), ...JSON.parse(raw) };
  } catch {}
  if (!S.day) S.day = todayStr();
  if (!S.menus) S.menus = {};
  if (!S.log || S.log.date !== S.day) S.log = freshLog(S.day);
  // 旧数据兼容：没有按日存储时，把当前 dishes 视为今天的菜单
  if (!S.menus[S.day]) S.menus[S.day] = Array.isArray(S.dishes) ? S.dishes : [];
  S.dishes = S.menus[S.day];
  if (!S.log.meals) S.log.meals = { breakfast: [], lunch: [], dinner: [] };
  if (!Array.isArray(S.history)) S.history = [];
  if (!S.chats) S.chats = {};
  if (!S.plans) S.plans = {};
  if (!S.logs) S.logs = {};
  // 旧数据迁移：把原来那份全局对话归到今天
  if (Array.isArray(S.coach) && S.coach.length && !S.chats[S.day]) S.chats[S.day] = S.coach;
  delete S.coach;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {}
}

// ---------------- 计算 ----------------
function budget() {
  if (!S.profile) return null;
  return E.dailyBudget({ ...S.profile, state: S.state });
}

// ---------------- 轻提示（不依赖原生 alert） ----------------
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------------- 通用请求 ----------------
async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (r.status === 401) {
    location.reload(); // 会话过期，回到登录页
    throw new Error('会话已过期');
  }
  return r.json();
}

function compressImage(file, maxSide = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('压缩失败'))), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = URL.createObjectURL(file);
  });
}
const blobToDataUrl = (blob) =>
  new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });

// ---------------- 档案 ----------------
function fillProfileForm() {
  const p = S.profile;
  if (!p) return; // 新用户：表单保持全空，不给任何默认值
  $('p-sex').value = p.sex;
  $('p-age').value = p.age;
  $('p-height').value = p.heightCm;
  $('p-weight').value = p.weightKg;
  $('p-target').value = p.targetWeightKg;
  $('p-date').value = p.targetDate;
  $('p-activity').value = p.activity || 'light';
}

function renderProfileResult() {
  const box = $('profileResult');
  const b = budget();
  if (!b) {
    box.innerHTML = '';
    return;
  }
  const g = b.goal;
  const warns = g.warnings || [];
  box.innerHTML = `
    <div class="card">
      <h2>你的方案</h2>
      <div class="metrics">
        <div class="metric"><div class="v">${b.bmr}</div><div class="k">基础代谢</div></div>
        <div class="metric"><div class="v">${b.tdee}</div><div class="k">每日消耗</div></div>
        <div class="metric hl"><div class="v">${b.targetKcal}</div><div class="k">每日目标 kcal</div></div>
      </div>
      <div class="hr"></div>
      <p class="muted" style="margin:0">
        BMI ${g.bmi}｜需减 ${g.loss} kg｜计划 ${g.weeks} 周｜每周约 ${g.ratePerWeek} kg${g.ratePerWeek > g.maxRatePerWeek ? '（超过安全上限 ' + g.maxRatePerWeek + '）' : ''}<br/>
        蛋白质 ${b.protein} g · 脂肪 ${b.fat} g · 碳水 ${b.carb} g
        ${b.floorHit ? '<br/>⚠ 按目标算出的热量已低于安全下限，已自动上调到基础代谢的 1.1 倍。' : ''}
      </p>
      ${warns
        .map(
          (w) => `<div class="alert ${w.level}" style="margin-top:10px">
            ${w.text}
            ${w.suggest ? `<span class="sug">${w.suggest.text}</span>` : ''}
            ${w.suggest && w.suggest.suggestedDate ? `<button class="small ghost" id="applySuggest" style="margin-top:6px" data-date="${w.suggest.suggestedDate}">采用建议日期</button>` : ''}
          </div>`
        )
        .join('')}
      ${warns.length === 0 ? '<div class="alert ok" style="margin-top:10px">目标健康，节奏合理。</div>' : ''}
    </div>`;
  const btn = $('applySuggest');
  if (btn) {
    btn.addEventListener('click', () => {
      $('p-date').value = btn.dataset.date;
      saveProfile();
    });
  }
}

function saveProfile() {
  const age = Number($('p-age').value);
  const heightCm = Number($('p-height').value);
  const weightKg = Number($('p-weight').value);
  const targetWeightKg = Number($('p-target').value);
  const targetDate = $('p-date').value;
  const sex = $('p-sex').value;
  const activity = $('p-activity').value;

  if (!sex || !activity) {
    toast('性别和日常活动量也要选一下');
    return;
  }
  if (!age || !heightCm || !weightKg || !targetWeightKg || !targetDate) {
    toast('档案还没填完：年龄、身高、体重、目标、日期都要填');
    return;
  }
  if (heightCm < 120 || heightCm > 230 || weightKg < 30 || weightKg > 250 || age < 14 || age > 60) {
    toast('这几个数字不太对，检查一下身高和体重');
    return;
  }
  if (targetWeightKg <= 0) {
    toast('目标体重要大于 0');
    return;
  }

  const profile = { sex, age, heightCm, weightKg, targetWeightKg, targetDate, activity };
  S.profile = profile;
  save();
  renderAll();

  const btn = $('saveProfile');
  btn.textContent = '已保存 ✓';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = '保存并生成方案';
    btn.disabled = false;
  }, 1600);
  const card = $('profileResult');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('方案已更新，看下面的「你的方案」');
}

// ---------------- 今日 ----------------
function eatenToday() {
  return E.sumIntake(Object.values(S.log.meals).flat().filter(Boolean));
}

function renderHero(b, plan) {
  const box = $('hero');
  const stateInfo = E.STATE_FACTORS[S.state] || E.STATE_FACTORS.normal;

  if (!b) {
    box.innerHTML = `<div class="card hero hero-empty">
      <div class="hero-label">还没有档案</div>
      <p class="muted" style="margin:8px 0 12px">填完身高体重和目标，这里会显示你今天还能吃多少。</p>
      <button class="block" onclick="document.querySelector('nav button[data-tab=\\'profile\\']').click()">去填档案</button>
    </div>`;
    return;
  }

  const eaten = eatenToday();
  const pct = Math.min(100, Math.round((eaten.kcal / b.targetKcal) * 100));
  const left = Math.max(0, Math.round(b.targetKcal - eaten.kcal));
  const over = eaten.kcal > b.targetKcal;

  box.innerHTML = `
    <div class="card hero hero-${S.state}">
      <div class="hero-top">
        <div class="hero-main">
          <div class="hero-label">${S.day === todayStr() ? '今天' : S.day.slice(5) + ' 周' + weekdayOf(S.day) + ' · '}${over ? '超出' : '还能吃'}</div>
          <div class="hero-num${over ? ' over' : ''}"><b id="heroNum">0</b><span>kcal</span></div>
          <div class="hero-sub">已摄入 ${Math.round(eaten.kcal)} · 目标 ${b.targetKcal}</div>
        </div>
        <div class="ring" style="--p:${pct}"><div><b>${pct}%</b><small>已用</small></div></div>
      </div>
      <div class="hero-bar"><i style="width:${pct}%"></i></div>
      <div class="hero-stats">
        <div><b>${b.deficit}</b><span>热量缺口</span></div>
        <div><b>${b.protein}</b><span>蛋白 g</span></div>
        <div><b>${plan.level}·${plan.minutes}′</b><span>今日训练</span></div>
      </div>
      <div class="hero-tip">${S.state === 'normal' ? '按计划吃，今天不用特别克制。' : `因为${stateInfo.label}，缺口已按 ${Math.round(stateInfo.deficit * 100)}% 缩小，今天不用硬扛。`}</div>
    </div>`;

  countUp($('heroNum'), over ? Math.round(eaten.kcal - b.targetKcal) : left, 700);
}

function countUp(el, to, dur = 520) {
  if (!el) return;
  const prev = heroLastValue;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || prev === to) {
    el.textContent = to;
    heroLastValue = to;
    return;
  }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(prev + (to - prev) * e);
    if (p < 1) requestAnimationFrame(tick);
    else heroLastValue = to;
  };
  requestAnimationFrame(tick);
}

function renderStrip(b, plan) {
  const box = $('strip');
  if (!box) return;
  if (!b) {
    box.innerHTML = '';
    return;
  }
  const eaten = eatenToday();
  const leftProtein = Math.max(0, Math.round(b.protein - eaten.protein));
  const days = (S.history || []).length;
  const stateInfo = E.STATE_FACTORS[S.state] || E.STATE_FACTORS.normal;

  box.innerHTML = `
    <div class="hscroll">
      <div class="hcard">
        <div class="k">蛋白还差</div>
        <div class="v">${leftProtein}<small>g</small></div>
        <div class="d">目标 ${b.protein} g</div>
      </div>
      <div class="hcard warm">
        <div class="k">今日状态</div>
        <div class="v" style="font-size:17px;letter-spacing:-0.3px">${stateInfo.label}</div>
        <div class="d">${S.state === 'normal' ? '按计划执行' : '已自动降档'}</div>
      </div>
      <div class="hcard dark">
        <div class="k">今日训练</div>
        <div class="v">${plan.minutes}<small>分钟</small></div>
        <div class="d">${plan.level}强度 · 约 ${plan.burnKcal} kcal</div>
      </div>
      <div class="hcard">
        <div class="k">已记录</div>
        <div class="v">${days}<small>天</small></div>
        <div class="d">${days >= 2 ? '可以看趋势了' : '再记一天出趋势'}</div>
      </div>
    </div>`;
}

/** 把一个动作拆成"动作名 + 括号里的要点"，避免长句挤在一起 */
function exItem(text, i) {
  const raw = String(text || '').trim();
  const m = raw.match(/^(.+?)[（(](.+)[）)]\s*$/);
  const main = (m ? m[1] : raw).trim();
  const note = m ? m[2].trim() : '';
  return `<div class="item ex"><span class="idx">${i + 1}</span><div class="grow">
    <div class="name">${main}</div>
    ${note ? `<div class="meta">${note}</div>` : ''}
  </div></div>`;
}

function renderToday() {
  const b = budget();
  const stateInfo = E.STATE_FACTORS[S.state] || E.STATE_FACTORS.normal;

  document.querySelectorAll('#stateChips .chip').forEach((c) => {
    c.classList.toggle('on', c.dataset.state === S.state);
  });

  $('stateHint').textContent = b
    ? `当前：${stateInfo.label} —— ${stateInfo.note}`
    : '还没有档案，请先到“档案”页填写。';

  // 训练
  const plan = E.trainingPlan({
    state: S.state,
    minutes: Number($('t-minutes').value) || S.minutes,
    streak: Number($('t-streak').value) || 0,
  });

  const cached = (S.plans || {})[S.day];
  const wantMinutes = Number($('t-minutes').value) || S.minutes;
  // 状态或时长变了，旧的 AI 方案就作废，先回到本地规则
  const aiPlan = cached && cached.state === S.state && Math.abs((cached.minutes || 0) - wantMinutes) < 1 ? cached : null;
  const stale = cached && !aiPlan;
  const view = aiPlan
    ? {
        level: aiPlan.level,
        minutes: aiPlan.totalMinutes,
        burnKcal: Math.round(aiPlan.totalMinutes * (E.TRAINING_RATE[aiPlan.level] || 4)),
        blocks: aiPlan.blocks,
        why: aiPlan.why,
        ai: true,
        notes: [],
      }
    : { ...plan, ai: false };

  // Hero 和横向卡也必须用同一份方案，否则会出现"上面 18 分钟、下面 30 分钟"
  renderHero(b, view);
  renderStrip(b, view);

  const bodyHtml = view.blocks
    ? view.blocks
        .map(
          (b) => `<div class="tblock"><div class="tblock-h">${b.title}</div><div class="list">${b.items
            .map((t, i) => exItem(t, i))
            .join('')}</div></div>`
        )
        .join('')
    : `<div class="list">${view.items.map((t, i) => exItem(t, i)).join('')}</div>`;

  $('trainingBox').innerHTML = `
    <div class="metrics" style="margin-bottom:8px">
      <div class="metric"><div class="v">${view.level}</div><div class="k">强度</div></div>
      <div class="metric"><div class="v">${view.minutes}</div><div class="k">分钟</div></div>
      <div class="metric"><div class="v">${view.burnKcal}</div><div class="k">约消耗 kcal</div></div>
    </div>
    ${
      view.ai
        ? `<div class="ai-note"><b>AI 编排 · ${S.state === 'normal' ? '正常' : S.state === 'tired' ? '熬夜困倦' : '疲惫不适'} · ${wantMinutes} 分钟</b>${view.why || '按你今天的身体状态和可用时间生成'}</div>`
        : stale
          ? '<div class="ai-note local"><b>本地规则（状态已变）</b>AI 方案按旧状态生成，已作废，点下面重新排一套</div>'
          : '<div class="ai-note local"><b>本地规则</b>按状态与时长从动作库中挑选，可让 AI 重排</div>'
    }
    ${bodyHtml}
    ${(view.notes || []).map((n) => `<p class="hint">${n}</p>`).join('')}
    <div class="row" style="margin-top:12px;gap:8px">
      <button id="btnAiPlan" class="small ghost">${view.ai ? '再换一套' : '让 AI 重排一套'}</button>
      <button id="btnWhyPlan" class="small plain">为什么这么排</button>
    </div>`;

  const aiBtn = $('btnAiPlan');
  if (aiBtn) aiBtn.addEventListener('click', () => fetchAiPlan());
  const whyBtn = $('btnWhyPlan');
  if (whyBtn)
    whyBtn.addEventListener('click', () => {
      sendCoach('为什么今天给我排这套训练？这个强度和时长是怎么定的？');
      const el = document.getElementById('coachLog');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

  renderMealPlan(b);
}

/** 今日配餐：优先用 AI 的结果，菜单或状态变了就作废，回落到规则搭配 */
function renderMealPlan(b) {
  const box = $('todayMeals');
  if (!box) return;

  if (!S.dishes.length) {
    box.innerHTML = '<p class="muted" style="margin:0">还没有今天的菜单。到「食堂」页录入菜品后，这里会自动出三餐方案。</p>';
    return;
  }
  if (!b) {
    box.innerHTML = '<p class="muted" style="margin:0">先填档案。</p>';
    return;
  }

  const sig = E.dishSignature(S.dishes);
  const cached = (S.mealPlans || {})[S.day];
  const ai =
    cached && cached.sig === sig && cached.state === S.state && Math.abs((cached.kcal || 0) - b.targetKcal) < 1
      ? cached
      : null;

  // 规则搭配始终算一遍：打卡页的「按推荐填入」要用
  const opt = E.optimizeMeals(S.dishes, b);
  optimizeCache = opt;

  let body;
  if (ai) {
    body = Object.keys(E.MEAL_SPLIT)
      .map((k) => {
        const items = ai.meals[k] || [];
        if (!items.length) return '';
        const sum = items.reduce((a, d) => a + d.kcal, 0);
        return `<div class="meal">
          <div class="meal-head"><b>${E.MEAL_LABEL[k]}</b><span>${sum} kcal</span></div>
          <div class="list">${items
            .map(
              (d) => `<div class="item"><div class="grow">
                <div class="name">${d.name}${d.portion !== 1 ? ` <i class="mini">×${d.portion}</i>` : ''}</div>
                <div class="meta">${d.kcal} kcal · 蛋白 ${d.protein}g · 脂肪 ${d.fat}g</div>
              </div></div>`
            )
            .join('')}</div>
        </div>`;
      })
      .join('');
    body += `<div class="hr"></div>
      <p class="muted" style="margin:0">合计 ${ai.totals.kcal} / ${b.targetKcal} kcal，蛋白 ${ai.totals.protein} / ${b.protein} g。</p>
      ${ai.why ? `<div class="ai-note" style="margin-top:10px"><b>AI 配餐</b>${ai.why}</div>` : ''}
      ${(ai.tips || []).map((t) => `<p class="hint">· ${t}</p>`).join('')}`;
  } else {
    body = Object.keys(E.MEAL_SPLIT)
      .map((k) => {
        const m = opt.meals[k];
        if (!m || !m.items.length) return '';
        return `<div class="meal">
          <div class="meal-head"><b>${E.MEAL_LABEL[k]}</b><span>${Math.round(m.sum.kcal)} / ${Math.round(m.target.kcal)} kcal</span></div>
          <div class="list">${m.items
            .map(
              (d) => `<div class="item"><div class="grow"><div class="name">${d.name}</div><div class="meta">${d.kcal} kcal · 蛋白 ${d.protein}g</div></div></div>`
            )
            .join('')}</div>
        </div>`;
      })
      .join('');
    body += `<div class="hr"></div>
      <p class="muted" style="margin:0">合计 ${opt.totals.kcal} / ${b.targetKcal} kcal，蛋白 ${opt.totals.protein} / ${b.protein} g。</p>
      <div class="ai-note local" style="margin-top:10px"><b>本地规则</b>在今天的菜单里做组合优化，可让 AI 重新配。</div>`;
  }

  box.innerHTML =
    body +
    `<div class="row" style="margin-top:12px;gap:8px">
       <button id="btnAiMeals" class="small ghost">${ai ? '让 AI 换个搭配' : '让 AI 配三餐'}</button>
     </div>`;

  const btn = $('btnAiMeals');
  if (btn) btn.addEventListener('click', () => fetchAiMeals());
}

async function fetchAiMeals() {
  const b = budget();
  if (!b || !S.dishes.length) return;
  const btn = $('btnAiMeals');
  const prev = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'AI 正在配…';
  }
  try {
    const r = await post('/api/meals', {
      dishes: S.dishes.map((d) => ({ name: d.name, kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb || 0 })),
      target: { kcal: b.targetKcal, protein: b.protein, fat: b.fat, carb: b.carb },
      state: S.state,
    });
    if (!r.ok) throw new Error(r.error || '配餐失败');
    if (r.mock) {
      toast('还没配置 AI 密钥，先用规则搭配');
      return;
    }
    const checked = E.validateAiMeals(r.plan, S.dishes, {
      kcal: b.targetKcal,
      protein: b.protein,
      fat: b.fat,
      carb: b.carb,
    });
    if (!checked) {
      toast('AI 搭配没对上目标（热量或蛋白偏差大），已保留原方案');
      return;
    }
    S.mealPlans = S.mealPlans || {};
    S.mealPlans[S.day] = {
      ...checked,
      sig: E.dishSignature(S.dishes),
      state: S.state,
      kcal: b.targetKcal,
    };
    save();
    renderToday();
    toast('AI 配好了三餐');
  } catch (e) {
    toast('配餐失败：' + e.message);
  } finally {
    const el = $('btnAiMeals');
    if (el) {
      el.disabled = false;
      el.textContent = prev;
    }
  }
}

// ---------------- 食堂 ----------------
function renderDishes() {
  $('dishCount').textContent = `${S.dishes.length} 道`;
  const dayTag = $('dishDay');
  if (dayTag) dayTag.textContent = S.day === todayStr() ? '今天' : `${S.day.slice(5)} 周${weekdayOf(S.day)}`;
  if (!S.dishes.length) {
    $('dishList').innerHTML = '<p class="muted" style="margin:0">还没有菜品。可以用上面的 AI 解析、拍照，或直接导入内置菜库。</p>';
    return;
  }
  const MAX = 6;
  const shown = dishExpanded ? S.dishes : S.dishes.slice(0, MAX);
  $('dishList').innerHTML =
    shown
      .map(
        (d) =>
          `<div class="item">
          <div class="grow">
            <div class="name">${d.name}${d.sample ? ' <i class="mini">示例</i>' : ''}</div>
            <div class="meta">${d.kcal} kcal · 蛋白 ${d.protein}g · 脂肪 ${d.fat}g${d.confidence ? ` · 置信度 ${Math.round(d.confidence * 100)}%` : ''}</div>
          </div>
          <button class="del" data-del="${d.id}">×</button>
        </div>`
      )
      .join('') +
    (S.dishes.length > MAX
      ? `<button class="small plain" id="toggleDishes" style="margin-top:4px">${dishExpanded ? '收起' : `展开全部 ${S.dishes.length} 道`}</button>`
      : '');

  const toggle = $('toggleDishes');
  if (toggle)
    toggle.addEventListener('click', () => {
      dishExpanded = !dishExpanded;
      renderDishes();
    });

  $('dishList').querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      S.dishes = S.dishes.filter((d) => d.id !== b.dataset.del);
      optimizeCache = null;
      save();
      renderAll();
    })
  );
}

function renderAiResult(dishes, note) {
  const box = $('aiResult');
  if (!dishes || !dishes.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <div class="card">
      <h2>识别结果 <span class="tag">可以改，AI 一定会不准</span></h2>
      ${note ? `<p class="hint" style="margin-top:0">${note}</p>` : ''}
      <div class="ai-rows">
        <div class="ai-head">
          <span>菜品</span><span>热量 kcal</span><span>蛋白 g</span><span>脂肪 g</span>
        </div>
        ${dishes
          .map(
            (d, i) => `<div class="ai-row">
              <span class="ai-name">${d.name}</span>
              <input id="ai-k-${i}" type="number" inputmode="numeric" value="${Math.round(d.kcal)}" />
              <input id="ai-p-${i}" type="number" inputmode="numeric" value="${Math.round(d.protein)}" />
              <input id="ai-f-${i}" type="number" inputmode="numeric" value="${Math.round(d.fat)}" />
            </div>`
          )
          .join('')}
      </div>
      <button id="aiAdd" class="block" style="margin-top:10px">加入今日菜单</button>
      <p class="hint">上面三列都是 AI 估的，按你看到的实际份量改一下再加进菜单。</p>
    </div>`;

  $('aiAdd').addEventListener('click', () => {
    dishes.forEach((d, i) => {
      S.dishes.push({
        ...d,
        id: `d-${Date.now()}-${i}`,
        kcal: Number($(`ai-k-${i}`).value) || d.kcal,
        protein: Number($(`ai-p-${i}`).value) || d.protein,
        fat: Number($(`ai-f-${i}`).value) || d.fat,
      });
    });
    optimizeCache = null;
    save();
    box.innerHTML = '';
    renderAll();
  });
}


async function fetchAiPlan() {
  const btn = $('btnAiPlan');
  const prev = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'AI 正在排…';
  }
  try {
    const chat = currentChat();
    const lastMe = [...chat].reverse().find((m) => m.role === 'me');
    const r = await post('/api/plan', {
      profile: S.profile,
      state: S.state,
      minutes: Number($('t-minutes').value) || S.minutes,
      extra: lastMe ? lastMe.text : '',
    });
    if (!r.ok) throw new Error(r.error || '生成失败');
    if (r.mock) {
      toast('还没配置 AI 密钥，先用本地规则方案');
      return;
    }
    const checked = E.validateAiPlan(r.plan, Number($('t-minutes').value) || S.minutes);
    if (!checked) {
      toast('AI 给的方案不合规（动作或时长不对），已保留原方案');
      return;
    }
    S.plans = S.plans || {};
    S.plans[S.day] = { ...checked, state: S.state, minutes: Number($('t-minutes').value) || S.minutes };
    save();
    renderToday();
    toast('AI 重新排了一套');
  } catch (e) {
    toast('排课失败：' + e.message);
  } finally {
    const b = $('btnAiPlan');
    if (b) {
      b.disabled = false;
      b.textContent = prev;
    }
  }
}

async function doExtract() {
  const text = $('dishText').value.trim();
  if (!text) return;
  const btn = $('btnExtract');
  btn.disabled = true;
  btn.textContent = '识别中…';
  try {
    const r = await post('/api/extract', { text });
    if (!r.ok) throw new Error(r.error || '解析失败');
    renderAiResult(r.dishes, r.note);
  } catch (e) {
    renderAiResult([], '');
    toast('解析失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '让 AI 估算热量';
  }
}

async function doVision(file) {
  const box = $('aiResult');
  box.innerHTML = '<div class="card"><p class="muted" style="margin:0"><span class="spin">◌</span> 正在识别，约 6–10 秒…</p></div>';
  try {
    const blob = await compressImage(file);
    const dataUrl = await blobToDataUrl(blob);
    const r = await post('/api/vision', { image: dataUrl });
    if (!r.ok) throw new Error(r.error || '识别失败');
    renderAiResult(r.dishes, r.note || '');
  } catch (e) {
    box.innerHTML = `<div class="card"><div class="alert warn" style="margin:0">识别失败：${e.message}。可以改用上方的文字输入。</div></div>`;
  }
}

// ---------------- 打卡 ----------------
function saveCurrentDay(b, actual, score) {
  const all = Object.values(S.log.meals).flat().filter(Boolean);
  if (!all.length || !b) return null;
  const date = S.log.date;
  S.history = S.history.filter((h) => h.date !== date);
  S.history.unshift({
    date,
    kcal: Math.round(actual.kcal),
    target: b.targetKcal,
    protein: Math.round(actual.protein),
    fat: Math.round(actual.fat),
    score,
    state: S.state,
    trainingDone: S.log.trainingDone,
  });
  S.history = S.history.slice(0, 30);
  if (!S.logs) S.logs = {};
  S.logs[date] = JSON.parse(JSON.stringify(S.log));
  save();
  return date;
}

function renderDayBar() {
  const box = $('dayBar');
  if (!box) return;
  const isToday = S.day === todayStr();
  const logged = Object.values(S.log.meals).some((a) => a.length);
  box.innerHTML = `<div class="daybar">
    <div class="daybar-l">
      <b>${S.day.slice(5)}</b>
      <span>周${weekdayOf(S.day)}</span>
      <em>${isToday ? '今天' : '模拟日期'}</em>
      ${logged ? '<i class="dot"></i>' : ''}
    </div>
    ${isToday ? '' : '<button class="small plain" id="btnBackToday">回到今天</button>'}
  </div>`;

  const back = $('btnBackToday');
  if (back)
    back.addEventListener('click', () => {
      const b = budget();
      const all = Object.values(S.log.meals).flat().filter(Boolean);
      let saved = null;
      if (all.length && b) {
        const actual = E.sumIntake(all);
        const loggedMeals = Object.values(S.log.meals).filter((a) => a.length).length;
        saved = saveCurrentDay(b, actual, E.scoreDay(actual, b, loggedMeals).total);
      }
      const today = todayStr();
      const dropped = dropFutureData(today);
      const inherited = switchDayTo(today);
      save();
      renderAll();
      const parts = [];
      if (saved) parts.push(`已顺带保存 ${saved.slice(5)}`);
      if (inherited) parts.push('已沿用当天菜单');
      if (dropped) parts.push(`已清理 ${dropped} 条演示数据`);
      toast(parts.length ? parts.join('，') : '已回到今天');
    });
}

function pickerHtml(meal) {
  if (logPicker.mode === 'pick') {
    const list = S.dishes.length
      ? S.dishes
          .map((d) => `<button class="pick-item" data-pickid="${d.id}"><span>${d.name}</span><small>${d.kcal}</small></button>`)
          .join('')
      : '<p class="muted" style="margin:0;font-size:13px">今天的菜单还是空的，先去「食堂」页录入菜品。</p>';
    return `<div class="picker">
      <div class="pick-list">${list}</div>
      <button class="small plain block" data-cancel="1" style="margin-top:8px">完成</button>
    </div>`;
  }
  return `<div class="picker">
    <div class="field"><label>菜名</label><input id="m-name-${meal}" placeholder="例如：红烧肉" /></div>
    <div class="row">
      <div class="field"><label>热量 kcal</label><input id="m-kcal-${meal}" type="number" inputmode="numeric" placeholder="300" /></div>
      <div class="field"><label>蛋白 g</label><input id="m-protein-${meal}" type="number" inputmode="numeric" placeholder="10" /></div>
      <div class="field"><label>脂肪 g</label><input id="m-fat-${meal}" type="number" inputmode="numeric" placeholder="10" /></div>
    </div>
    <div class="row">
      <button class="small ghost" data-cancel="1">取消</button>
      <button class="small" data-save="${meal}">加入${E.MEAL_LABEL[meal]}</button>
    </div>
  </div>`;
}

function renderLog() {
  const b = budget();
  const box = $('logMeals');
  box.innerHTML =
    Object.keys(E.MEAL_SPLIT)
      .map((k) => {
        const items = S.log.meals[k] || [];
        const sum = E.sumIntake(items);
        return `<div class="meal">
          <div class="meal-head"><b>${E.MEAL_LABEL[k]}</b><span>${Math.round(sum.kcal)} kcal</span></div>
          <div class="list">
            ${
              items.length
                ? items
                    .map(
                      (d, i) => `<div class="item"><div class="grow"><div class="name">${d.name}</div><div class="meta">${d.kcal} kcal · 蛋白 ${d.protein}g · 脂肪 ${d.fat}g</div></div><button class="del" data-rm="${k}:${i}">×</button></div>`
                    )
                    .join('')
                : '<p class="muted" style="margin:0;font-size:13px">还没记录</p>'
            }
          </div>
          ${
            logPicker && logPicker.meal === k
              ? pickerHtml(k)
              : `<div class="row meal-actions" style="margin-top:8px">
                  <button class="small plain" data-fill="${k}">按推荐</button>
                  <button class="small ghost" data-pick="${k}">从菜单</button>
                  <button class="small ghost" data-manual="${k}">手动添加</button>
                </div>`
          }
        </div>`;
      })
      .join('');

  box.querySelectorAll('[data-rm]').forEach((el) =>
    el.addEventListener('click', () => {
      const [k, i] = el.dataset.rm.split(':');
      S.log.meals[k].splice(Number(i), 1);
      save();
      renderAll();
    })
  );
  box.querySelectorAll('[data-pick]').forEach((el) =>
    el.addEventListener('click', () => {
      logPicker = { meal: el.dataset.pick, mode: 'pick' };
      renderLog();
    })
  );
  box.querySelectorAll('[data-manual]').forEach((el) =>
    el.addEventListener('click', () => {
      logPicker = { meal: el.dataset.manual, mode: 'manual' };
      renderLog();
    })
  );
  box.querySelectorAll('[data-cancel]').forEach((el) =>
    el.addEventListener('click', () => {
      logPicker = null;
      renderLog();
    })
  );
  box.querySelectorAll('[data-pickid]').forEach((el) =>
    el.addEventListener('click', () => {
      const d = S.dishes.find((x) => x.id === el.dataset.pickid);
      if (!d || !logPicker) return;
      S.log.meals[logPicker.meal].push({ ...d, id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
      save();
      renderLog();
    })
  );
  box.querySelectorAll('[data-save]').forEach((el) =>
    el.addEventListener('click', () => {
      const meal = el.dataset.save;
      const name = ($(`m-name-${meal}`).value || '').trim();
      if (!name) {
        toast('先填一个菜名');
        return;
      }
      S.log.meals[meal].push({
        id: `log-${Date.now()}`,
        name,
        kcal: Math.max(0, Number($(`m-kcal-${meal}`).value) || 0),
        protein: Math.max(0, Number($(`m-protein-${meal}`).value) || 0),
        fat: Math.max(0, Number($(`m-fat-${meal}`).value) || 0),
        carb: 0,
      });
      logPicker = null;
      save();
      renderAll();
    })
  );
  box.querySelectorAll('[data-fill]').forEach((el) =>
    el.addEventListener('click', () => {
      const k = el.dataset.fill;
      if (!optimizeCache) {
        toast('还没有推荐方案，请先到「食堂」页生成');
        return;
      }
      const m = optimizeCache.meals[k];
      S.log.meals[k] = (m?.items || []).map((d, i) => ({ ...d, id: `log-${Date.now()}-${i}` }));
      save();
      renderAll();
    })
  );

  // 评分
  const scoreBox = $('scoreBox');
  if (!b) {
    scoreBox.innerHTML = '<p class="muted" style="margin:0">先填档案。</p>';
  } else {
    const all = Object.values(S.log.meals).flat();
    const loggedMeals = Object.values(S.log.meals).filter((a) => a.length).length;
    if (!all.length) {
      scoreBox.innerHTML = '<p class="muted" style="margin:0">先记录至少一餐，才会出分数。</p>';
    } else {
      const actual = E.sumIntake(all);
      const s = E.scoreDay(actual, b, loggedMeals);
      scoreBox.innerHTML = `
        <div class="score-wrap">
          <div class="score-ring" style="--p:${s.total}"><div>${s.total}</div></div>
          <div class="bars">
            ${s.parts
              .map(
                (p) => `<div class="bar-row">
                  <div class="t"><span>${p.name}</span><span>${p.detail}</span></div>
                  <div class="bar"><i style="width:${p.score}%"></i></div>
                </div>`
              )
              .join('')}
          </div>
        </div>
        ${s.tips.map((t) => `<div class="alert warn" style="margin-top:10px">${t}</div>`).join('')}
        <button id="saveDay" class="block" style="margin-top:10px">保存并进入下一天</button>`;
      $('saveDay').addEventListener('click', () => {
        const saved = saveCurrentDay(b, actual, s.total);
        const inherited = switchDayTo(addDays(S.day, 1));
        save();
        renderAll();
        const tail = inherited ? `（沿用 ${S.dishes.length} 道菜）` : '';
        toast(saved ? `${saved.slice(5)} 已保存 → ${S.day.slice(5)}${tail}` : `今天没记录，进入 ${S.day.slice(5)}${tail}`);
      });
    }
  }
  renderHistory();
  drawTrend();
}


function renderHistory() {
  const box = $('historyBox');
  if (!S.history.length) {
    box.innerHTML = '<p class="muted" style="margin:0">还没有历史记录。</p>';
    return;
  }
  box.innerHTML = `<div class="list">${S.history
    .slice(0, 7)
    .map(
      (h) => `<div class="item"><div class="grow">
        <div class="name">${h.date}　${h.score} 分</div>
        <div class="meta">${h.kcal} kcal · 蛋白 ${h.protein}g · 脂肪 ${h.fat}g · ${E.STATE_FACTORS[h.state]?.label || '正常'}</div>
      </div></div>`
    )
    .join('')}</div>`;
}

// ---------------- AI 教练 ----------------
function currentChat() {
  if (!S.chats) S.chats = {};
  if (!Array.isArray(S.chats[S.day])) S.chats[S.day] = [];
  return S.chats[S.day];
}

function renderCoach() {
  const box = $('coachLog');
  const msgs = currentChat();
  if (!msgs.length) {
    box.innerHTML = `<div class="bubble ai">今天想怎么练？告诉我可用时间、当前状态，或者哪里不太舒服。我会按宿舍无器械场景，给你一套能执行的方案。</div>`;
    return;
  }
  box.innerHTML = msgs
    .map((m) => {
      if (m.role === 'me') return `<div class="bubble me">${escapeHtml(m.text)}</div>`;
      return `<div class="bubble ai">
        <div>${escapeHtml(m.text)}</div>
        ${(m.advice || []).map((a) => `<div class="advice">· ${escapeHtml(a)}</div>`).join('')}
        ${(m.items || []).length ? `<button class="small ghost" data-additems='${JSON.stringify(m.items).replace(/'/g, '&#39;')}'>把这几样记进打卡</button>` : ''}
      </div>`;
    })
    .join('');
  box.scrollTop = box.scrollHeight;

  box.querySelectorAll('[data-additems]').forEach((b) =>
    b.addEventListener('click', () => {
      const items = JSON.parse(b.dataset.additems);
      const meal = S.log.meals.dinner.length ? 'dinner' : S.log.meals.lunch.length ? 'dinner' : 'lunch';
      items.forEach((d, i) => S.log.meals[meal].push({ ...d, id: `coach-${Date.now()}-${i}`, carb: d.carb || 0 }));
      save();
      renderAll();
      toast(`已记入${E.MEAL_LABEL[meal]}`);
    })
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function localCoachReply(profile, plan) {
  const bmi = E.bmi(profile || {});
  const minutes = Math.min(Number(plan?.minutes) || 20, 30);
  return `按你的档案（BMI ${Number.isFinite(bmi) ? bmi.toFixed(1) : '未填'}，目标 ${profile?.targetWeightKg || '未填'} kg），今天建议做 ${minutes} 分钟低到中等强度循环：深蹲、跪姿俯卧撑、臀桥、死虫式各 2–3 组，组间休息 45–60 秒。每周 3–4 次，强度以 RPE 11–13（能说话但不能唱歌）为宜；熬夜或疲惫时减半。训练前热身 3–5 分钟，出现疼痛、眩晕或胸闷立即停止，必要时咨询医生或康复师。`;
}

function typeCoachText(msg, full) {
  return new Promise((resolve) => {
    let i = 0;
    const step = Math.max(1, Math.ceil(full.length / 55));
    const tick = () => {
      i = Math.min(full.length, i + step);
      msg.text = full.slice(0, i);
      renderCoach();
      if (i >= full.length) {
        msg.text = full;
        resolve();
        return;
      }
      setTimeout(tick, 24);
    };
    setTimeout(tick, 220);
  });
}

async function streamSportChat(payload, onChunk) {
  const res = await fetch('/api/chat-sport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) throw new Error('运动 AI 暂时不可用');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  while (!done) {
    const part = await reader.read();
    if (part.done) break;
    buffer += decoder.decode(part.value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let data;
        try { data = JSON.parse(raw); } catch { continue; }
        if (data.t) onChunk(String(data.t));
        if (data.done) done = true;
      }
    }
  }
  if (!done) throw new Error('运动 AI 没有返回完整回复');
}

async function sendCoach(text) {
  if (!text.trim()) return;
  if ($('coachSend').disabled) return;
  const chat = currentChat();
  chat.push({ role: 'me', text });
  while (chat.length > 12) chat.shift();
  save();
  renderCoach();

  const plan = E.trainingPlan({ state: S.state, minutes: S.minutes, streak: S.streak });
  const btn = $('coachSend');
  btn.disabled = true;
  btn.textContent = '…';
  const aiMsg = { role: 'ai', text: '', advice: [], items: [] };
  chat.push(aiMsg);
  renderCoach();
  try {
    const profile = S.profile || {};
    await streamSportChat(
      {
        message: text,
        profile: {
          ...profile,
          bmi: Number.isFinite(E.bmi(profile)) ? Number(E.bmi(profile).toFixed(1)) : null,
        },
        plan: {
          minutes: Number(S.minutes) || 20,
          streak: Number(S.streak) || 0,
          state: (E.STATE_FACTORS[S.state] || {}).label || '正常',
          training: `${plan.level}强度 ${plan.minutes} 分钟`,
        },
        history: chat.slice(-8).map((m) => ({ role: m.role, text: m.text })),
      },
      (chunk) => {
        aiMsg.text += chunk;
        renderCoach();
      }
    );
    if (!aiMsg.text.trim()) throw new Error('empty');
  } catch (e) {
    aiMsg.text = '';
    await typeCoachText(aiMsg, localCoachReply(S.profile || {}, plan));
  } finally {
    while (chat.length > 12) chat.shift();
    save();
    renderCoach();
    btn.disabled = false;
    btn.textContent = '发送';
  }
}

// ---------------- 7 天趋势 ----------------
function drawTrend() {
  const cv = $('trend');
  if (!cv) return;
  const hint = $('trendHint');
  const data = (S.history || []).slice(0, 7).sort((a, b) => (a.date < b.date ? -1 : 1));

  const W = cv.clientWidth;
  if (!W) return; // 页签隐藏时不画，切回来再画

  if (data.length < 2) {
    hint.textContent = '再记录一天就能看到趋势。';
    cv.width = W * 2;
    cv.height = 150;
    const c0 = cv.getContext('2d');
    c0.clearRect(0, 0, cv.width, cv.height);
    return;
  }
  hint.textContent = '柱子＝当天摄入，虚线＝当天目标，折线＝评分。';

  const dpr = 2;
  const H = 150;
  cv.width = W * dpr;
  cv.height = H * dpr;
  cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const padL = 8, padR = 8, padT = 18, padB = 22;
  const maxKcal = Math.max(...data.map((d) => Math.max(d.kcal, d.target || 0))) * 1.15;
  const bw = (W - padL - padR) / data.length;

  data.forEach((d, i) => {
    const x = padL + i * bw;
    const w = bw * 0.52;
    const h = ((H - padT - padB) * d.kcal) / maxKcal;
    const y = H - padB - h;
    ctx.fillStyle = d.target && d.kcal > d.target * 1.08 ? '#c08a3e' : '#178a58';
    roundRect(ctx, x + (bw - w) / 2, y, w, h, 4);
    ctx.fill();

    if (d.target) {
      const ty = H - padB - ((H - padT - padB) * d.target) / maxKcal;
      ctx.strokeStyle = '#c9ced6';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x + 2, ty);
      ctx.lineTo(x + bw - 2, ty);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = '#9aa1ab';
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.date.slice(5), x + bw / 2, H - 6);
  });

  // 评分折线
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = padL + i * bw + bw / 2;
    const y = padT + (H - padT - padB) * (1 - Math.min(100, d.score || 0) / 100);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = '#12a150';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  data.forEach((d, i) => {
    const x = padL + i * bw + bw / 2;
    const y = padT + (H - padT - padB) * (1 - Math.min(100, d.score || 0) / 100);
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#12a150';
    ctx.fill();
    ctx.fillStyle = '#12a150';
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(d.score ?? ''), x, y - 6);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------------- 模式选择 ----------------
// 登录后先让用户二选一；特殊健康状况模式是独立页面（health.html），
// 不复用、也不改动本文件的减脂数据与计算。
function showModeScreen() {
  const screen = $('modeScreen');
  if (!screen) return;
  document.body.classList.remove('fatloss-mode');
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', '#f2f8f4');
  screen.hidden = false;
  document.querySelector('header').style.display = 'none';
  document.querySelector('main').style.display = 'none';
  document.querySelector('nav').style.display = 'none';
}

function enterFatloss() {
  const screen = $('modeScreen');
  if (screen) screen.hidden = true;
  document.body.classList.add('fatloss-mode');
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', '#f2f8f4');
  document.querySelector('header').style.display = '';
  document.querySelector('main').style.display = '';
  document.querySelector('nav').style.display = '';
  renderAll();
}

// ---------------- 渲染总入口 ----------------
function renderAll() {
  fillProfileForm();
  renderProfileResult();
  renderToday();
  renderDayBar();
  renderCoach();
  renderDishes();
  renderLog();
}


// ---------------- 事件绑定 ----------------
function bind() {
  // 模式选择页：减脂进入原应用，特殊健康跳到独立页面
  const modeFat = $('modeFatloss');
  const modeDis = $('modeDisease');
  if (modeFat) modeFat.addEventListener('click', enterFatloss);
  if (modeDis) modeDis.addEventListener('click', () => (location.href = './health.html'));

  const switchModeBtn = $('btnSwitchMode');
  if (switchModeBtn) switchModeBtn.addEventListener('click', showModeScreen);

  document.querySelectorAll('nav button').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
      if (b.dataset.tab === 'log') requestAnimationFrame(drawTrend);
    })
  );

  window.addEventListener('resize', () => drawTrend());

  $('saveProfile').addEventListener('click', saveProfile);

  document.querySelectorAll('#stateChips .chip').forEach((c) =>
    c.addEventListener('click', () => {
      const hadAi = Boolean((S.plans || {})[S.day]);
      S.state = c.dataset.state;
      if (hadAi) delete S.plans[S.day];
      save();
      renderAll();
      if (hadAi) toast('状态变了，方案已按新状态重算，可让 AI 重排');
    })
  );

  ['t-minutes', 't-streak'].forEach((id) =>
    $(id).addEventListener('change', () => {
      const hadAi = Boolean((S.plans || {})[S.day]);
      S.minutes = Number($('t-minutes').value) || 30;
      S.streak = Number($('t-streak').value) || 0;
      if (hadAi) delete S.plans[S.day];
      save();
      renderToday();
      if (hadAi) toast('时长变了，方案已重算，可让 AI 重排');
    })
  );

  $('btnExtract').addEventListener('click', doExtract);

  const coachSend = () => {
    const t = $('coachText').value.trim();
    if (!t) return;
    $('coachText').value = '';
    sendCoach(t);
  };
  $('coachSend').addEventListener('click', coachSend);
  $('coachText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') coachSend();
  });
  document.querySelectorAll('.quick button[data-q]').forEach((b) =>
    b.addEventListener('click', () => sendCoach(b.dataset.q))
  );

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (f) doVision(f);
    e.target.value = '';
  };
  $('cam').addEventListener('change', onPick);
  $('gal').addEventListener('change', onPick);
  $('btnCamera').addEventListener('click', () => $('cam').click());
  $('btnGallery').addEventListener('click', () => $('gal').click());

  // 清空全部数据（演示前重置）
  let resetArmed = false;
  let resetTimer = null;
  const resetBtn = $('btnResetAll');
  if (resetBtn)
    resetBtn.addEventListener('click', () => {
      const resetAll = () => {
        try {
          localStorage.removeItem(KEY);
        } catch {}
        location.reload();
      };
      if (!resetArmed) {
        resetArmed = true;
        resetBtn.textContent = '确认清空？所有记录都会没';
        resetBtn.classList.add('armed');
        resetTimer = setTimeout(() => {
          resetArmed = false;
          resetBtn.textContent = '清空本机所有数据';
          resetBtn.classList.remove('armed');
        }, 4000);
        return;
      }
      clearTimeout(resetTimer);
      resetAll();
    });

  let clearArmed = false;
  let clearTimer = null;
  const resetClear = () => {
    clearArmed = false;
    const btn = $('btnClearDishes');
    if (btn) {
      btn.textContent = '清空';
      btn.classList.remove('armed');
    }
  };
  $('btnClearDishes').addEventListener('click', () => {
    const btn = $('btnClearDishes');
    if (!S.dishes.length) {
      toast('菜单已经是空的');
      return;
    }
    if (!clearArmed) {
      clearArmed = true;
      btn.textContent = `确认清空 ${S.dishes.length} 道？`;
      btn.classList.add('armed');
      clearTimeout(clearTimer);
      clearTimer = setTimeout(resetClear, 4000);
      return;
    }
    clearTimeout(clearTimer);
    resetClear();
    S.dishes = [];
    optimizeCache = null;
    dishExpanded = false;
    save();
    renderAll();
    toast('已清空今日菜单，打卡记录未受影响');
  });

  $('btnBuiltin').addEventListener('click', async () => {
    try {
      const list = await (await fetch('./dishes.json')).json();
      const have = new Set(S.dishes.map((d) => d.name));
      let added = 0;
      for (const d of list) {
        if (!have.has(d.name)) {
          S.dishes.push({ ...d, id: `b-${d.id}`, sample: true });
          added++;
        }
      }
      optimizeCache = null;
      save();
      renderAll();
      toast(`已导入 ${added} 道示例菜，请删掉你们食堂没有的`);
    } catch (e) {
      toast('导入失败：' + e.message);
    }
  });

}

// ---------------- 跨零点检测 ----------------
function checkDayRollover() {
  const today = todayStr();
  if (S.day >= today) return;
  const hasData = Object.values(S.log.meals || {}).some((a) => a.length);
  if (hasData) return; // 还有没保存的记录，不擅自跳走
  switchDayTo(today);
  save();
  renderAll();
  toast(`已经是新的一天（${today.slice(5)}）`);
}

// ---------------- 启动 ----------------
/** 把登录流程的每一步写进 localStorage，供 /diag.html 回看 */
function authLog(step, extra) {
  try {
    const key = 'cf-auth-log';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    arr.push({ t: new Date().toISOString().slice(11, 23), step, extra: extra === undefined ? '' : String(extra).slice(0, 160) });
    localStorage.setItem(key, JSON.stringify(arr.slice(-40)));
  } catch {}
}

function showBootError(msg) {
  const el = document.getElementById('bootError');
  if (!el) return;
  el.hidden = false;
  el.textContent = String(msg).slice(0, 200);
}
window.addEventListener('error', (e) => showBootError('脚本错误：' + (e.message || '未知')));
window.addEventListener('unhandledrejection', (e) =>
  showBootError('异步错误：' + ((e.reason && e.reason.message) || e.reason || '未知'))
);

function showAuth(errText) {
  const screen = $('authScreen');
  if (!screen) return;
  document.body.classList.remove('fatloss-mode');
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', '#f2f8f4');
  const modeEl = $('modeScreen');
  if (modeEl) modeEl.hidden = true;
  screen.hidden = false;
  document.querySelector('header').style.display = 'none';
  document.querySelector('main').style.display = 'none';
  document.querySelector('nav').style.display = 'none';

  if (errText) $('authErr').textContent = errText;
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    $('tabLogin').classList.toggle('on', m === 'login');
    $('tabRegister').classList.toggle('on', m === 'register');
    $('authSubmit').textContent = m === 'login' ? '登录' : '注册并进入';
    $('authErr').textContent = '';
  };
  $('tabLogin').onclick = () => setMode('login');
  $('tabRegister').onclick = () => setMode('register');

  const submit = async () => {
    const btn = $('authSubmit');
    const label = mode === 'login' ? '登录' : '注册并进入';
    const username = $('authUser').value.trim();
    const password = $('authPass').value;
    $('authErr').textContent = '';
    if (!username || !password) {
      $('authErr').textContent = '用户名和密码都要填';
      return;
    }
    btn.disabled = true;
    btn.textContent = '请稍候…';
    authLog('① 开始', mode);

    const restore = (msg) => {
      btn.disabled = false;
      btn.textContent = label;
      if (msg) $('authErr').textContent = msg;
      authLog('✗ 结束', msg || '');
    };

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      authLog('② 请求发出', mode === 'login' ? '/api/auth/login' : '/api/auth/register');

      const r = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      authLog('③ 收到响应', r.status);

      const data = await r.json().catch(() => ({}));
      authLog('④ 解析完成', 'ok=' + data.ok + ' token=' + (data.token ? '有' : '无'));

      if (!r.ok || !data.ok) throw new Error(data.error || '失败了，再试一次');

      if (data.token) {
        setToken(data.token);
        authLog('⑤ token 已存');
      }

      authLog('⑥ 准备进入主界面');
      try {
        await startApp(data.user);
        document.getElementById('authScreen').hidden = true;
        authLog('⑦ 已进入主界面');
      } catch (e) {
        authLog('✗ startApp 抛错', e && e.message);
        restore('进入主界面失败：' + (e && e.message));
      }
    } catch (e) {
      authLog('✗ 请求失败', (e && e.name) + ':' + (e && e.message));
      restore(e && e.name === 'AbortError' ? '请求超时（25 秒没响应），检查网络' : (e && e.message) || '未知错误');
    }
  };
  $('authSubmit').onclick = submit;
  $('authPass').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
}

async function boot() {
  // 先确认登录状态，未登录就只显示登录页
  let me = null;
  try {
    me = await (await fetch('/api/auth/me', { headers: authHeaders() })).json();
  } catch {}
  if (!me || !me.user) {
    showAuth(me && me.error && me.error !== '未登录' ? me.error : '');
    return;
  }
  try {
    await startApp(me.user);
  } catch (e) {
    showBootError('进入主界面失败：' + e.message);
    throw e;
  }
}

async function startApp(user) {
  // 恢复界面（登录页可能把 header/main/nav 藏了）
  const screen = document.getElementById('authScreen');
  if (screen) screen.hidden = true;
  document.querySelector('header').style.display = '';
  document.querySelector('main').style.display = '';
  document.querySelector('nav').style.display = '';

  // 每个账号一份独立的本地数据
  KEY = 'canteen-fit-v1::' + user.id;
  const logout = $('btnLogout');
  if (logout)
    logout.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
      setToken('');
      location.reload();
    });

  load();
  if (S.profile) {
    $('t-minutes').value = S.minutes;
    $('t-streak').value = S.streak;
  }
  bind();
  renderAll();
  showModeScreen();

  // 切回页面、或隔一会儿，检查是否跨过零点
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkDayRollover();
  });
  window.addEventListener('focus', checkDayRollover);
  setInterval(checkDayRollover, 60 * 1000);

  try {
    const h = await (await fetch('/api/health')).json();
    const badge = $('aiBadge');
    if (badge) {
      badge.hidden = false;
      badge.textContent = 'AI 双助手';
      badge.className = 'pill';
    }
  } catch {}
}

boot();
