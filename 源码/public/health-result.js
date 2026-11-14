// health-result.js —— 特殊健康状况：独立结果页
import {
  getSessionUser, loadHealthData, loadSetup, findCondition, findConditionMeta,
  calorieRange, tagOf, searchFoods, foodCounts, loadMeals, saveMeals,
  loadChat, saveChat, authHeaders, escapeHtml, toast,
} from './health-common.js';
import { MEAL_META, scoreMeal, scoreDay, trendData, toDateKey, mealShare } from './health-score.js';
import { generateNutritionReply } from './health-chat.js';

const $ = (id) => document.getElementById(id);
let user = null;
let data = null;
let setup = null;
let condition = null;
let meta = null;
let calorie = null;
let meals = [];
let chat = [];
let chatBusy = false;
let chatTyping = false;
let editingMeal = '';
let pendingMealPhoto = '';
let pendingChatPhoto = '';
let foodFilter = 'all';

const MAX_MEAL_PHOTOS = 60;

const FALLBACK_PRESETS = {
  breakfast: [
    { name: '包子', kcal: 230 }, { name: '鸡蛋', kcal: 70 }, { name: '小米粥', kcal: 120 },
    { name: '豆浆', kcal: 90 }, { name: '牛奶', kcal: 130 }, { name: '玉米', kcal: 110 },
    { name: '红薯', kcal: 130 }, { name: '全麦面包', kcal: 120 },
  ],
  lunch: [
    { name: '米饭', kcal: 230 }, { name: '馒头', kcal: 220 }, { name: '清蒸鱼', kcal: 120 },
    { name: '番茄炒蛋', kcal: 150 }, { name: '清炒时蔬', kcal: 80 }, { name: '鸡胸肉', kcal: 140 },
    { name: '牛肉', kcal: 160 }, { name: '豆腐', kcal: 90 },
  ],
  dinner: [
    { name: '米饭', kcal: 230 }, { name: '馒头', kcal: 220 }, { name: '清蒸鱼', kcal: 120 },
    { name: '番茄炒蛋', kcal: 150 }, { name: '清炒时蔬', kcal: 80 }, { name: '鸡胸肉', kcal: 140 },
    { name: '牛肉', kcal: 160 }, { name: '豆腐', kcal: 90 },
  ],
};

const RECOGNITION_COMBOS = {
  breakfast: [['包子', '鸡蛋', '豆浆'], ['全麦面包', '牛奶', '鸡蛋']],
  lunch: [['米饭', '清蒸鱼', '清炒时蔬'], ['米饭', '番茄炒蛋', '鸡胸肉']],
  dinner: [['馒头', '豆腐', '清炒时蔬'], ['米饭', '牛肉', '清炒时蔬']],
};

const HERO_DECO = `<div class="hero-deco" aria-hidden="true">
  <svg viewBox="0 0 160 160" fill="none">
    <path d="M30 84h100c-4 27-23 43-50 43S34 111 30 84z" stroke="white" stroke-width="3.2"/>
    <path d="M24 84h112" stroke="white" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M80 72c2-19 14-31 35-34-2 20-13 32-35 34z" stroke="white" stroke-width="3.2"/>
    <path d="M80 72c-2-14-11-23-26-26 2 15 10 24 26 26z" stroke="white" stroke-width="3.2"/>
    <path d="M80 72V36" stroke="white" stroke-width="3.2" stroke-linecap="round"/>
  </svg>
</div>`;

const REHAB_ICONS = {
  exercise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4.5" r="1.8"/><path d="M12.5 7.5l-2 4 2.5 2 1.5 5"/><path d="M11 11.5l-3 2"/><path d="M13 13.5l3.5 1.5"/><path d="M10 19l-2 2"/></svg>',
  avoid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/></svg>',
  routine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
  sleep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z"/></svg>',
  hydration: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5c3.2 4 5 6.7 5 9.2a5 5 0 0 1-10 0c0-2.5 1.8-5.2 5-9.2z"/></svg>',
  daily: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5L12 4l8 7.5"/><path d="M6 10.5V20h12v-9.5"/><path d="M10 20v-4h4v4"/></svg>',
  mood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c1 1.2 2.1 1.8 3.5 1.8s2.5-.6 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13h4l2-5 3 9 2-4h5"/><path d="M5 4.5h14v15H5z" opacity=".55"/></svg>',
};

function compressImage(file, maxSide = 720, quality = 0.68) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('请选择图片文件'));
    if (file.size > 12 * 1024 * 1024) return reject(new Error('图片太大，请换一张小于 12MB 的'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('这张图片暂时无法处理'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function dailyTarget() {
  const raw = calorie?.center || ((calorie?.low || 0) + (calorie?.high || 0)) / 2;
  return Math.round(raw / 50) * 50;
}

function todayKey() {
  return toDateKey();
}

function todayMeals() {
  return meals.filter((m) => m.date === todayKey());
}

function latestDietPhoto() {
  return todayMeals()
    .filter((m) => m.photo)
    .sort((a, b) => b.time - a.time)[0]?.photo || '';
}

function todayCalories() {
  return todayMeals().reduce((sum, m) => sum + (Number(m.kcal) > 0 ? Number(m.kcal) : 0), 0);
}

function renderCalorieSummary() {
  if (!calorie) return;
  const target = dailyTarget();
  const intake = todayCalories();
  const remain = target - intake;
  const over = remain < 0;

  $('csTarget').textContent = target;
  $('csIntake').textContent = intake;
  $('csRemain').textContent = remain;
  $('csRange').textContent = `参考区间 ${calorie.low}–${calorie.high} kcal`;
  $('csRemainBox').classList.toggle('over', over);
  $('csBar').style.width = `${target > 0 ? Math.min(100, (intake / target) * 100) : 0}%`;
  $('csHint').textContent = over
    ? `已超出推荐值 ${Math.abs(remain)} kcal，下一餐注意清淡与份量。`
    : `今天还可摄入约 ${remain} kcal；数值随三餐记录实时更新。`;
}

function activatePanel(name) {
  document.querySelectorAll('.health-tab').forEach((b) => {
    const on = b.dataset.panel === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.health-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
}

function bindTabs() {
  document.querySelectorAll('.health-tab').forEach((btn) => {
    btn.addEventListener('click', () => activatePanel(btn.dataset.panel));
  });
}

function renderHero() {
  const p = setup.profile;
  const sexText = p.sex === 'male' ? '男' : '女';
  const profileLine = `${sexText} · ${p.age} 岁 · ${p.heightCm} cm · ${p.weightKg} kg · ${calorie.activityLabel}`;
  $('resultHero').innerHTML = `
    <div class="health-hero-inner">
      ${HERO_DECO}
      <div class="hero-topline">
        <span class="hero-cat">${escapeHtml(meta.categoryName)}</span>
        <span class="hero-chip">${escapeHtml(condition.tag || '健康饮食')}</span>
      </div>
      <h2>${escapeHtml(condition.name)}</h2>
      <p class="hero-summary">${escapeHtml(condition.summary || '')}</p>
      <div class="calorie-box">
        <div class="calorie-main">
          <b>${calorie.low}–${calorie.high}</b>
          <span>kcal / 日参考区间</span>
        </div>
        <div class="calorie-side">
          <span>基础代谢约 ${calorie.bmr} kcal</span>
          <span>${escapeHtml(profileLine)}</span>
        </div>
      </div>
      <p class="hero-note">${escapeHtml(calorie.note || '')}</p>
    </div>`;
}

function renderMeals() {
  const box = $('mealList');
  const meals = Array.isArray(condition.meals) ? condition.meals : [];
  box.innerHTML = meals
    .map((m, mi) => {
      const items = (m.items || [])
        .map(
          (it) => `<div class="item health-food-item">
            <div class="grow">
              <div class="name">${escapeHtml(it.name)} <i class="portion">${escapeHtml(it.portion || '')}</i></div>
              ${it.note ? `<div class="meta">${escapeHtml(it.note)}</div>` : ''}
            </div>
            ${it.kcal ? `<span class="food-kcal">${it.kcal} kcal</span>` : ''}
          </div>`
        )
        .join('');
      return `<div class="card meal-card">
        <div class="meal-head">
          <div><b>${escapeHtml(m.name)}</b><span class="meal-kcal">参考 ${m.kcal || ''} kcal</span></div>
          <button class="small plain" type="button" data-meal-record="${mi}">记这一餐</button>
        </div>
        <div class="list">${items}</div>
      </div>`;
    })
    .join('') || '<div class="card"><p class="muted" style="margin:0">暂未配置食谱。</p></div>';

  box.querySelectorAll('[data-meal-record]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = meals[Number(btn.dataset.mealRecord)];
      if (!m) return;
      activatePanel('records');
      openMealEditor(m.key || 'lunch');
    });
  });

  $('principles').innerHTML = (condition.principles || [])
    .map((s) => `<div class="advice">· ${escapeHtml(s)}</div>`)
    .join('') || '<p class="muted" style="margin:0">暂无额外原则。</p>';
}

function renderFoodFilters() {
  const counts = foodCounts(condition);
  const items = [
    { key: 'all', label: `全部 ${(condition.foods || []).length}` },
    { key: 'forbidden', label: `🔴 禁食 ${counts.forbidden}` },
    { key: 'limit', label: `🟡 少吃 ${counts.limit}` },
    { key: 'recommend', label: `🟢 推荐 ${counts.recommend}` },
  ];
  $('foodFilters').innerHTML = items
    .map((x) => `<button type="button" class="food-filter ${foodFilter === x.key ? 'on' : ''}" data-filter="${x.key}">${x.label}</button>`)
    .join('');
  $('foodFilters').querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      foodFilter = btn.dataset.filter;
      renderFoodFilters();
      renderFoodList();
    });
  });
}

function renderFoodList() {
  const q = $('foodSearch').value;
  const list = searchFoods(condition, q, foodFilter);
  if (!list.length) {
    $('foodList').innerHTML = `<p class="muted" style="margin:12px 0 0">没有找到匹配的食物，换个关键词试试。</p>`;
    return;
  }
  $('foodList').innerHTML = list
    .slice(0, 60)
    .map((f) => {
      const t = tagOf(f);
      return `<div class="food-row">
        <span class="food-tag ${t.cls}">${t.emoji} ${t.label}</span>
        <div class="food-main">
          <div class="food-name">${escapeHtml(f.name)}</div>
          <div class="food-amount">建议量：${escapeHtml(f.amount || '按实际情况')}</div>
          ${f.note ? `<div class="food-note">${escapeHtml(f.note)}</div>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

function renderRehabItem(x) {
  if (typeof x === 'string') return `<div class="rehab-line"><span>${escapeHtml(x)}</span></div>`;
  return `<div class="rehab-line"><b>${escapeHtml(x.name || '')}</b><span>${escapeHtml(x.detail || '')}</span></div>`;
}

function renderActivity() {
  const r = condition.rehab;
  if (!r) {
    $('activityBox').innerHTML = '<div class="card"><p class="muted" style="margin:0">暂未配置康复生活建议。</p></div>';
    return;
  }
  const order = ['exercise', 'avoid', 'routine', 'sleep', 'hydration', 'daily', 'mood', 'monitor'];
  const cards = order
    .map((key) => {
      const s = r[key];
      if (!s) return '';
      const items = (s.items || []).map(renderRehabItem).join('') || '<div class="rehab-line"><span>按医护与康复师意见执行。</span></div>';
      return `<section class="card rehab-card ${key === 'avoid' ? 'rehab-avoid' : ''}">
        <div class="rehab-head">
          <span class="rehab-ico">${REHAB_ICONS[key] || ''}</span>
          <div><b>${escapeHtml(s.title || '')}</b><small>${key === 'exercise' ? '按阶段与体力调整' : key === 'monitor' ? '遵医护安排' : '日常可执行'}</small></div>
        </div>
        <div class="rehab-body">${items}</div>
        ${s.note ? `<p class="rehab-note">${escapeHtml(s.note)}</p>` : ''}
      </section>`;
    })
    .join('');

  $('activityBox').innerHTML = `
    <div class="card rehab-intro">
      <div class="rehab-intro-head">
        <span class="rehab-badge">康复生活指导</span>
        <span class="rehab-ref">参考一般康复与慢病管理原则</span>
      </div>
      <p>${escapeHtml(r.intro || '')}</p>
      <div class="rehab-pill-row">
        <span>运动</span><span>作息</span><span>睡眠</span><span>饮水</span><span>起居</span><span>情绪</span><span>监测</span>
      </div>
    </div>
    <div class="rehab-grid">${cards}</div>`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function mealEntry(mealKey, date = todayKey()) {
  return meals.find((m) => m.date === date && m.meal === mealKey) || null;
}

function mealTarget(mealKey) {
  return Math.round(dailyTarget() * mealShare(condition, mealKey));
}

function scoreClass(score) {
  if (score >= 85) return 'good';
  if (score >= 70) return 'warn';
  return 'bad';
}

function mealCardHTML(m) {
  const entry = mealEntry(m.key);
  const target = mealTarget(m.key);
  const head = `<div class="meal-title"><span class="meal-icon">${m.icon}</span><div><b>${m.name}</b><small>参考约 ${target} kcal</small></div></div>`;
  if (!entry) {
    return `<article class="meal-record card empty" data-meal-card="${m.key}">
      <div class="meal-record-head">
        ${head}
        <span class="meal-status">未记录</span>
      </div>
      <p class="meal-empty-text">还没有记录${m.name}，写下食物和热量后会立即评分。</p>
      <button class="small meal-add" data-meal-open="${m.key}" type="button">记录${m.name}</button>
    </article>`;
  }

  const tags = [];
  if (entry.forbidden?.length) tags.push(`<span class="meal-tag forbidden">🔴 禁 ${entry.forbidden.slice(0, 3).map(escapeHtml).join('、')}</span>`);
  if (entry.limit?.length) tags.push(`<span class="meal-tag limit">🟡 少 ${entry.limit.slice(0, 3).map(escapeHtml).join('、')}</span>`);
  if (entry.recommend?.length) tags.push(`<span class="meal-tag recommend">🟢 推荐 ${entry.recommend.slice(0, 3).map(escapeHtml).join('、')}</span>`);

  return `<article class="meal-record card scored" data-meal-card="${m.key}">
    <div class="meal-record-head">
      ${head}
      <div class="meal-score ${scoreClass(entry.score || 0)}"><b>${entry.score || 0}</b><small>${escapeHtml(entry.grade || '')}</small></div>
    </div>
    <div class="meal-record-body">
      ${entry.photo ? `<img class="meal-photo" src="${escapeHtml(entry.photo)}" alt="${escapeHtml(m.name)}照片" />` : ''}
      <div class="meal-record-main">
        <p class="meal-foods">${escapeHtml(entry.text)}</p>
        <div class="meal-meta"><span>${Math.round(Number(entry.kcal) || 0)} kcal</span><span>${fmtTime(entry.time)}</span></div>
        <p class="meal-comment">${escapeHtml(entry.comment || '')}</p>
        <div class="meal-tags">${tags.join('')}</div>
      </div>
    </div>
    <div class="meal-record-actions">
      <button class="small plain" data-meal-open="${m.key}" type="button">修改</button>
      <button class="small plain meal-del" data-meal-del="${m.key}" type="button">删除</button>
    </div>
  </article>`;
}

function renderDailySummary() {
  const day = scoreDay(condition, meals, dailyTarget(), todayKey());
  const grade = day.covered ? (day.covered < 3 ? '待完整' : day.grade) : '待记录';
  const cls = day.covered ? scoreClass(day.score) : 'empty';
  $('dailySummary').innerHTML = `<div class="daily-summary card daily-${cls}">
    <div class="daily-ring" style="--p:${day.score}"><div><b>${day.score}</b><small>今日得分</small></div></div>
    <div class="daily-main">
      <div class="daily-title"><b>${grade}</b><span>${day.covered}/3 餐已记录</span></div>
      <p>${escapeHtml(day.evaluation)}</p>
      <div class="daily-meta">
        <span>已摄入 <b>${day.totalKcal}</b> kcal</span>
        <span>参考 <b>${day.target}</b> kcal</span>
        <span>覆盖 <b>${day.covered}/3</b></span>
      </div>
    </div>
  </div>`;
}

function renderTrend() {
  const list = trendData(condition, meals, dailyTarget(), 7);
  const recorded = list.filter((d) => d.score != null);
  if (!recorded.length) {
    $('trendChart').innerHTML = '<div class="trend-empty">还没有可绘制的数据。完成至少一餐记录后，这里会显示近 7 天的依从变化。</div>';
    return;
  }
  const W = 320;
  const H = 164;
  const left = 28;
  const right = 8;
  const top = 16;
  const bottom = 132;
  const plotW = W - left - right;
  const plotH = bottom - top;
  const xFor = (i) => left + (list.length <= 1 ? plotW / 2 : (i / (list.length - 1)) * plotW);
  const yFor = (s) => top + ((100 - s) / 100) * plotH;
  let path = '';
  let prev = false;
  list.forEach((d, i) => {
    if (d.score == null) { prev = false; return; }
    path += `${prev ? 'L' : 'M'}${xFor(i).toFixed(1)},${yFor(d.score).toFixed(1)} `;
    prev = true;
  });
  const grid = [0, 50, 100].map((v) => `<line x1="${left}" y1="${yFor(v)}" x2="${W - right}" y2="${yFor(v)}" stroke="#dfeae3" stroke-width="1"/><text x="2" y="${yFor(v) + 3}" fill="#8a9a91" font-size="8">${v}</text>`).join('');
  const dots = list.map((d, i) => d.score == null ? '' : `<circle cx="${xFor(i)}" cy="${yFor(d.score)}" r="3.4" fill="#ffffff" stroke="#178a58" stroke-width="2"/>`).join('');
  const labels = list.map((d, i) => `<text x="${xFor(i)}" y="${H - 12}" text-anchor="${i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'middle'}" fill="${d.label === '今天' ? '#178a58' : '#8a9a91'}" font-size="8" font-weight="${d.label === '今天' ? '700' : '400'}">${escapeHtml(d.label)}</text>`).join('');
  const last = recorded[recorded.length - 1].score;
  const best = Math.max(...recorded.map((d) => d.score));
  $('trendChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 7 天每日饮食得分趋势">
    ${grid}
    <path d="${path.trim()}" fill="none" stroke="#178a58" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    ${labels}
  </svg>
  <div class="trend-caption"><span>有记录 ${recorded.length} 天</span><span>最近 <b>${last}</b> 分 · 最高 <b>${best}</b> 分</span></div>`;
}

function mealPresetsFor(mealKey) {
  return data?.meta?.mealPresets?.[mealKey] || FALLBACK_PRESETS[mealKey] || [];
}

function syncQuickChips() {
  const text = $('mealFoods')?.value || '';
  document.querySelectorAll('#mealQuickFoods [data-quick-food]').forEach((btn) => {
    btn.classList.toggle('on', text.includes(btn.dataset.quickFood));
  });
}

function addQuickFood(name, kcal) {
  const text = $('mealFoods').value.trim();
  if (text.includes(name)) {
    toast(`已经加过「${name}」了，可直接修改份量或热量`);
    return;
  }
  $('mealFoods').value = text ? `${text}、${name}` : name;
  const current = Number($('mealKcal').value) || 0;
  $('mealKcal').value = Math.min(5000, current + (Number(kcal) || 0));
  syncQuickChips();
  $('mealFoods').focus();
}

function renderQuickFoods(mealKey) {
  const list = mealPresetsFor(mealKey);
  const meta = MEAL_META.find((m) => m.key === mealKey);
  if ($('mealQuickHint')) $('mealQuickHint').textContent = `${meta?.name || '这一餐'}常用 · 点击多选自动累加`;
  if (!list.length) {
    $('mealQuickFoods').innerHTML = '<span class="hint" style="margin:0">暂无预置食物，可直接手动输入。</span>';
    return;
  }
  $('mealQuickFoods').innerHTML = list
    .map((f) => `<button class="quick-food" type="button" data-quick-food="${escapeHtml(f.name)}" data-quick-kcal="${Number(f.kcal) || 0}">
      <span>${escapeHtml(f.name)}</span><small>${Number(f.kcal) || 0} kcal</small>
    </button>`)
    .join('');
  $('mealQuickFoods').querySelectorAll('[data-quick-food]').forEach((btn) => {
    btn.addEventListener('click', () => addQuickFood(btn.dataset.quickFood, btn.dataset.quickKcal));
  });
  syncQuickChips();
}

/** 纯前端本地模拟识别：文件名命中优先，否则按餐次选一个常见组合 */
function simulateMealRecognition(fileName, mealKey) {
  const list = mealPresetsFor(mealKey);
  const map = new Map(list.map((f) => [f.name, Number(f.kcal) || 0]));
  const combos = RECOGNITION_COMBOS[mealKey] || RECOGNITION_COMBOS.lunch;
  let seed = 0;
  for (const ch of String(fileName || 'image')) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
  let names = (combos[seed % combos.length] || []).filter((n) => map.has(n));
  const named = list.find((f) => String(fileName || '').includes(f.name));
  if (named) names = [named.name, ...names.filter((n) => n !== named.name)].slice(0, 3);
  if (!names.length) names = list.slice(0, 3).map((f) => f.name);
  return {
    text: names.join('、'),
    kcal: names.reduce((sum, n) => sum + (map.get(n) || 0), 0),
  };
}

function renderMealRecords() {
  const dock = $('mealEditorDock');
  const editor = $('mealEditor');
  if (dock && editor && editor.parentElement !== dock) dock.appendChild(editor);
  $('mealRecordList').innerHTML = MEAL_META.map(mealCardHTML).join('');
  $('mealRecordList').querySelectorAll('[data-meal-open]').forEach((btn) => {
    btn.addEventListener('click', () => openMealEditor(btn.dataset.mealOpen));
  });
  $('mealRecordList').querySelectorAll('[data-meal-del]').forEach((btn) => {
    btn.addEventListener('click', () => deleteMeal(btn.dataset.mealDel));
  });
  renderDailySummary();
  renderTrend();
  renderCalorieSummary();
}

function showMealPhoto() {
  const preview = $('mealPhotoPreview');
  const img = $('mealPhotoPreviewImg');
  if (!preview || !img) return;
  if (pendingMealPhoto) {
    img.src = pendingMealPhoto;
    preview.hidden = false;
  } else {
    img.removeAttribute('src');
    preview.hidden = true;
  }
}

function bindMealPhoto() {
  const btn = $('mealPhotoBtn');
  const input = $('mealPhotoInput');
  const remove = $('mealPhotoRemove');
  if (!btn || !input) return;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      pendingMealPhoto = await compressImage(file, 720, 0.68);
      showMealPhoto();
      const local = simulateMealRecognition(file.name, editingMeal || 'lunch');
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '识别中…';
      let recognized = null;
      try {
        const r = await fetch('/api/chat-diet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ mode: 'recognize', image: pendingMealPhoto }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ok && Array.isArray(d.foods) && d.foods.length) {
          const names = d.foods.map((x) => x.name).filter(Boolean).slice(0, 8);
          const sum = d.foods.reduce((s, x) => s + (Number(x.kcal) || 0), 0);
          recognized = {
            text: names.join('、'),
            kcal: Math.max(0, Math.round(Number(d.totalKcal) || sum)),
            ai: true,
          };
        }
      } catch {
        recognized = null;
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
      const rec = recognized || { ...local, ai: false };
      $('mealFoods').value = rec.text;
      $('mealKcal').value = rec.kcal;
      syncQuickChips();
      toast(`${rec.ai ? 'AI 识别' : '本地模拟识别'}：${rec.text}，可修改`);
    } catch (e) {
      toast(e.message);
    }
  });
  if (remove) {
    remove.addEventListener('click', () => {
      pendingMealPhoto = '';
      showMealPhoto();
    });
  }
}

function openMealEditor(mealKey) {
  const m = MEAL_META.find((x) => x.key === mealKey);
  if (!m) return;
  editingMeal = mealKey;
  const entry = mealEntry(mealKey);
  pendingMealPhoto = entry?.photo || '';
  $('mealFoods').value = entry?.text || '';
  $('mealKcal').value = entry?.kcal || '';
  $('mealEditorTitle').textContent = `${entry ? '修改' : '记录'}${m.name}`;
  $('mealEditorSub').textContent = entry ? `已评分 ${entry.score} 分，修改后重新评分` : '按当前病种规范评分';
  $('mealTargetHint').textContent = `${mealTarget(mealKey)} kcal`;
  showMealPhoto();
  renderQuickFoods(mealKey);

  const editor = $('mealEditor');
  const card = document.querySelector(`.meal-record[data-meal-card="${mealKey}"]`);
  if (card) card.insertAdjacentElement('afterend', editor);
  else if ($('mealEditorDock')) $('mealEditorDock').appendChild(editor);
  editor.hidden = false;
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => $('mealFoods').focus(), 150);
}

function closeMealEditor() {
  editingMeal = '';
  pendingMealPhoto = '';
  const editor = $('mealEditor');
  editor.hidden = true;
  if ($('mealEditorDock')) $('mealEditorDock').appendChild(editor);
  $('mealFoods').value = '';
  $('mealKcal').value = '';
  showMealPhoto();
}

function saveMeal() {
  if (!editingMeal) return;
  const text = $('mealFoods').value.trim();
  if (!text) {
    toast('先写一下这餐吃了什么');
    $('mealFoods').focus();
    return;
  }
  const raw = $('mealKcal').value.trim();
  let kcal = 0;
  if (raw) {
    kcal = Number(raw);
    if (!Number.isFinite(kcal) || kcal < 0 || kcal > 5000) {
      toast('热量请填写 0–5000 kcal 之间的数字');
      $('mealKcal').focus();
      return;
    }
  }
  const existing = mealEntry(editingMeal);
  const photoCount = meals.filter((x) => x.photo).length;
  if (pendingMealPhoto && !existing?.photo && photoCount >= MAX_MEAL_PHOTOS) {
    toast(`照片记录最多 ${MAX_MEAL_PHOTOS} 条，请先删除旧记录`);
    return;
  }
  const entry = {
    id: existing?.id || `meal-${Date.now()}`,
    date: todayKey(),
    meal: editingMeal,
    text: text.slice(0, 160),
    kcal: Math.round(kcal),
    time: Date.now(),
  };
  if (pendingMealPhoto) entry.photo = pendingMealPhoto;
  const sc = scoreMeal(condition, editingMeal, entry, dailyTarget());
  if (!sc) {
    toast('这餐还没有可评分的内容');
    return;
  }
  entry.score = sc.score;
  entry.grade = sc.grade;
  entry.comment = sc.comment;
  entry.targetKcal = sc.targetKcal;
  entry.forbidden = sc.forbidden.map((x) => x.name);
  entry.limit = sc.limit.map((x) => x.name);
  entry.recommend = sc.recommend.map((x) => x.name);
  entry.hits = sc.hits.map((x) => ({ name: x.name, tag: x.tag }));

  const before = meals.slice();
  meals = meals.filter((x) => !(x.date === entry.date && x.meal === entry.meal));
  meals.push(entry);
  if (!saveMeals(user.id, condition.id, meals)) {
    meals = before;
    toast('本地存储空间不足，请先删除旧照片或旧记录');
    return;
  }
  const name = MEAL_META.find((x) => x.key === editingMeal)?.name || '这一餐';
  closeMealEditor();
  renderMealRecords();
  toast(`${name}已记录 · ${sc.score} 分`);
}

function deleteMeal(mealKey) {
  const m = MEAL_META.find((x) => x.key === mealKey);
  if (!m || !mealEntry(mealKey)) return;
  if (!confirm(`删除今天的${m.name}记录？删除后会重新计算全天得分。`)) return;
  const before = meals.slice();
  meals = meals.filter((x) => !(x.date === todayKey() && x.meal === mealKey));
  if (!saveMeals(user.id, condition.id, meals)) {
    meals = before;
    toast('本地存储空间不足');
    return;
  }
  if (editingMeal === mealKey) closeMealEditor();
  renderMealRecords();
  toast(`已删除${m.name}记录`);
}

function bindMealEditor() {
  $('mealSave')?.addEventListener('click', saveMeal);
  $('mealCancel')?.addEventListener('click', closeMealEditor);
  $('mealCancelTop')?.addEventListener('click', closeMealEditor);
  $('mealFoods')?.addEventListener('input', syncQuickChips);
  $('mealKcal')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveMeal();
  });
  bindMealPhoto();
}

// ---------------- AI 营养师 ----------------
function renderChat() {
  const box = $('chatLog');
  if (!box) return;
  if (!chat.length && !chatBusy) {
    box.innerHTML = `<div class="chat-msg ai">
      我是 AI 营养师，只做膳食营养科普。你可以问我“这份早餐适合我吗”“今天蛋白质够吗”，也可以上传一张食物照片。
      <div class="chat-time">不会做医疗判断，也不替代医生/营养师/康复师方案</div>
    </div>`;
    return;
  }
  box.innerHTML = chat
    .map((m) => {
      const isMe = m.role === 'me';
      const img = m.image ? `<img class="chat-img" src="${escapeHtml(m.image)}" alt="食物照片" />` : '';
      const risk = m.risk ? '<div class="chat-risk">你描述的情况建议优先就医；以下内容仅作饮食科普。</div>' : '';
      const mock = m.mock ? '<div class="chat-time">本地营养科普</div>' : `<div class="chat-time">${fmtTime(m.time)}</div>`;
      return `<div class="chat-msg ${isMe ? 'me' : 'ai'}">${img}${escapeHtml(m.text)}${risk}${mock}</div>`;
    })
    .join('');
  if (chatBusy) {
    box.innerHTML += '<div class="chat-msg ai">AI 营养师正在结合你的健康状况和记录…</div>';
  }
  box.scrollTop = box.scrollHeight;
}

function showChatPhoto() {
  const preview = $('chatPhotoPreview');
  const img = $('chatPhotoPreviewImg');
  if (!preview || !img) return;
  if (pendingChatPhoto) {
    img.src = pendingChatPhoto;
    preview.hidden = false;
  } else {
    img.removeAttribute('src');
    preview.hidden = true;
  }
}

function bindChatPhoto() {
  const btn = $('chatPhotoBtn');
  const input = $('chatPhotoInput');
  const remove = $('chatPhotoRemove');
  if (!btn || !input) return;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      pendingChatPhoto = await compressImage(file, 640, 0.64);
      showChatPhoto();
    } catch (e) {
      toast(e.message);
    }
  });
  if (remove) {
    remove.addEventListener('click', () => {
      pendingChatPhoto = '';
      showChatPhoto();
    });
  }
}

function typeReply(msg, full) {
  return new Promise((resolve) => {
    let i = 0;
    const step = Math.max(1, Math.ceil(full.length / 55));
    const tick = () => {
      i = Math.min(full.length, i + step);
      msg.text = full.slice(0, i);
      renderChat();
      if (i >= full.length) {
        msg.text = full;
        resolve();
        return;
      }
      setTimeout(tick, 26);
    };
    setTimeout(tick, 260);
  });
}

async function streamDietChat(payload, onText) {
  const res = await fetch('/api/chat-diet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) throw new Error('膳食 AI 暂时不可用');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  let mock = false;
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
        if (data.t) onText(String(data.t));
        if (data.done) {
          done = true;
          mock = Boolean(data.mock);
        }
      }
    }
  }
  if (!done) throw new Error('膳食 AI 没有返回完整回复');
  return { mock };
}

async function sendChat(preset) {
  if (chatBusy || chatTyping) return;
  const text = String(preset ?? $('chatText').value).trim();
  const explicitPhoto = pendingChatPhoto;
  const image = explicitPhoto || latestDietPhoto();
  if (!text && !image) {
    toast('先写一句问题，或上传一张食物照片');
    return;
  }

  const userMsg = {
    role: 'me',
    text: text || '请看看这张食物照片，结合我的情况说说怎么吃。',
    time: Date.now(),
  };
  // 自动引用的最近饮食照片只随请求发送，不在每条消息里重复存一份 base64
  if (explicitPhoto) userMsg.image = explicitPhoto;
  chat.push(userMsg);
  if (!saveChat(user.id, condition.id, chat)) toast('对话缓存空间不足，已保留在当前页面');

  $('chatText').value = '';
  pendingChatPhoto = '';
  showChatPhoto();
  chatBusy = true;
  renderChat();

  const aiMsg = { role: 'ai', text: '', time: Date.now(), mock: false };
  chat.push(aiMsg);
  chatBusy = false;
  chatTyping = true;
  renderChat();

  try {
    const history = chat.slice(0, -2).slice(-8).map((m) => ({ role: m.role, text: m.text }));
    const result = await streamDietChat(
      {
        message: userMsg.text,
        image: image || '',
        conditionId: condition.id,
        conditionName: condition.name,
        profile: setup.profile,
        target: dailyTarget(),
        meals: todayMeals().map((m) => ({
          meal: m.meal,
          name: MEAL_META.find((x) => x.key === m.meal)?.name || '一餐',
          text: m.text,
          kcal: m.kcal || 0,
          score: m.score || 0,
        })),
        history,
      },
      (chunk) => {
        aiMsg.text += chunk;
        renderChat();
      }
    );
    aiMsg.mock = Boolean(result.mock);
    if (!aiMsg.text.trim()) throw new Error('膳食 AI 没有返回文字');
  } catch (e) {
    // 接口失败或密钥失效：自动降级为原有前端本地营养师
    aiMsg.text = '';
    aiMsg.mock = true;
    const fallback = generateNutritionReply({
      condition,
      meals,
      question: userMsg.text,
      image: Boolean(image),
      target: dailyTarget(),
      date: todayKey(),
    });
    await typeReply(aiMsg, fallback);
    toast('AI 接口暂不可用，已切换本地科普回复');
  } finally {
    if (!saveChat(user.id, condition.id, chat)) toast('对话缓存空间不足');
    chatBusy = false;
    chatTyping = false;
    renderChat();
  }
}

function bindChat() {
  $('chatSend')?.addEventListener('click', () => sendChat());
  $('chatText')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChat();
    }
  });
  document.querySelectorAll('[data-chat-q]').forEach((btn) => {
    btn.addEventListener('click', () => sendChat(btn.dataset.chatQ));
  });
  bindChatPhoto();
}

async function main() {
  user = await getSessionUser();
  if (!user) return;
  data = await loadHealthData();
  setup = loadSetup(user.id);
  if (!setup || !setup.conditionId || !setup.profile) {
    location.replace('./health.html');
    return;
  }
  condition = findCondition(data, setup.conditionId);
  meta = findConditionMeta(data, setup.conditionId);
  if (!condition || !meta || meta.status !== 'active') {
    location.replace('./health.html');
    return;
  }
  calorie = calorieRange(setup.profile, condition);
  meals = loadMeals(user.id, condition.id);
  chat = loadChat(user.id, condition.id);

  $('headerTag').textContent = `${meta.categoryName} · ${condition.tag || '健康饮食'}`;
  renderHero();
  renderMeals();
  renderFoodFilters();
  renderFoodList();
  renderActivity();
  renderMealRecords();
  renderChat();
  bindTabs();
  bindMealEditor();
  bindChat();

  $('foodSearch').addEventListener('input', renderFoodList);
}

main();
