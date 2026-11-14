// tools/shot.mjs —— 零依赖的无头浏览器截图 / 冒烟测试
// 用法：node tools/shot.mjs [url] [输出目录]
// 原理：启动本机 Chrome，用 CDP 设成 iPhone 尺寸，走一遍真实操作再截图。

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const URL_BASE = process.argv[2] || 'http://localhost:3000/';
const OUT_DIR = process.argv[3] || './shots';
const PORT = 9333;
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const exists = async (p) => {
  try { await (await import('node:fs/promises')).access(p); return true; } catch { return false; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findBrowser() {
  for (const p of CHROME_CANDIDATES) if (await exists(p)) return p;
  throw new Error('没找到 Chrome 或 Edge，请手动改 CHROME_CANDIDATES');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.persist = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        if (this.persist.has(msg.method)) this.persist.get(msg.method).forEach((fn) => fn(msg.params));
        if (this.events.has(msg.method)) {
          this.events.get(msg.method).forEach((fn) => fn(msg.params));
          this.events.delete(msg.method);
        }
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) {
    if (!this.persist.has(method)) this.persist.set(method, []);
    this.persist.get(method).push(fn);
  }
  once(method) {
    return new Promise((resolve) => {
      if (!this.events.has(method)) this.events.set(method, []);
      this.events.get(method).push(resolve);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.result?.description || ''));
    return r.result?.value;
  }
  async shot(file, fullPage = true) {
    const metrics = await this.send('Page.getLayoutMetrics');
    const h = fullPage ? Math.min(Math.ceil(metrics.cssContentSize.height), 6000) : VIEWPORT.height;
    const r = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: h, scale: 1 },
    });
    await writeFile(file, Buffer.from(r.data, 'base64'));
    console.log('  →', file);
  }
}

const main = async () => {
  const browser = await findBrowser();
  const profileDir = await mkdtemp(path.join(tmpdir(), 'cf-shot-'));
  await mkdir(OUT_DIR, { recursive: true });

  const proc = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1200,900',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    // 等调试端口起来
    let version = null;
    for (let i = 0; i < 60; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
        break;
      } catch { await sleep(200); }
    }
    if (!version) throw new Error('Chrome 调试端口没有起来');

    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 任何原生弹窗（alert/confirm/prompt）都记一次，并自动关闭
    let nativeDialogs = 0;
    cdp.on('Page.javascriptDialogOpening', async (params) => {
      nativeDialogs++;
      console.log('  ⚠ 触发原生弹窗：', params.type, '|', String(params.message || '').slice(0, 40));
      await cdp.send('Page.handleJavaScriptDialog', { accept: true });
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });

    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: URL_BASE });
    await loaded;
    await sleep(700);
    console.log('页面已加载：', await cdp.evaluate('document.title'));

    // 未登录时应该只看到登录页
    const authVisible = await cdp.evaluate("!document.getElementById('authScreen').hidden");
    const mainHidden = await cdp.evaluate("getComputedStyle(document.querySelector('main')).display === 'none'");
    console.log(`  未登录：登录页可见=${authVisible}，主界面隐藏=${mainHidden}`);
    await cdp.shot(path.join(OUT_DIR, '0-auth.png'));

    // 注册（会自动登录），然后刷新进入主界面
    const token = await cdp.evaluate(`(async () => {
      const name = 'demo' + Date.now().toString(36);
      const r = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password: 'abc12345' }),
      });
      const d = await r.json();
      return d.token || '';
    })()`);
    console.log('  拿到 token：', token ? '有（' + token.slice(0, 8) + '…）' : '无');

    // 模拟"代理层丢 Cookie"：清掉 cookie，只靠 token
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCookies');
    await cdp.evaluate(`localStorage.setItem('canteen-fit-token', ${JSON.stringify(token)})`);

    const reloaded2 = cdp.once('Page.loadEventFired');
    await cdp.send('Page.reload', {});
    await reloaded2;
    await sleep(900);
    // 登录后先出现「减脂 / 特殊健康」二选一；这里走减脂主流程
    const modeVisible = await cdp.evaluate("!document.getElementById('modeScreen').hidden");
    console.log('  模式选择页可见：', modeVisible);
    await cdp.evaluate("document.getElementById('modeFatloss').click(); 'ok'");
    await sleep(300);
    const mainVisible = await cdp.evaluate("getComputedStyle(document.querySelector('main')).display !== 'none'");
    console.log('  仅凭 token（无 cookie）能进主界面：', mainVisible);
    console.log('视口：', await cdp.evaluate('`${innerWidth}x${innerHeight} dpr=${devicePixelRatio}`'));

    // 0) 空档案点保存 → 应该提示，不该生成方案
    await cdp.evaluate(`document.getElementById('saveProfile').click(); 'ok'`);
    await sleep(300);
    const emptyToast = await cdp.evaluate("document.getElementById('toast')?.innerText || ''");
    const noPlan = await cdp.evaluate("!document.querySelector('#profileResult .card')");
    console.log('  空档案保存：', emptyToast, '｜未生成方案：', noPlan);
    await cdp.shot(path.join(OUT_DIR, '0-empty-profile.png'));

    // 1) 档案页：填表并保存
    await cdp.evaluate(`
      (() => {
        const set=(id,v)=>{const e=document.getElementById(id);e.value=v;};
        set('p-sex','female'); set('p-age',21); set('p-height',165); set('p-weight',72);
        set('p-target',63); set('p-date',new Date(Date.now()+21*864e5).toISOString().slice(0,10));
        set('p-activity','light');
        document.getElementById('saveProfile').click();
        return 'ok';
      })();
    `);
    await sleep(400);
    await cdp.shot(path.join(OUT_DIR, '1-profile.png'));
    const btnAfterSave = await cdp.evaluate("document.getElementById('saveProfile').innerText");
    console.log('  档案按钮保存后变为：', btnAfterSave);
    const warnText = await cdp.evaluate("document.querySelector('.alert')?.innerText || ''");
    console.log('  健康校验提示：', warnText.replace(/\\s+/g, ' ').slice(0, 60));

    // 2) 今日页：切到熬夜状态
    await cdp.evaluate(`document.querySelector('nav button[data-tab="today"]').click(); 'ok'`);
    await sleep(300);
    const before = await cdp.evaluate("document.querySelector('.hero-sub').innerText");
    await cdp.evaluate(`document.querySelector('#stateChips .chip[data-state="tired"]').click(); 'ok'`);
    await sleep(900);
    const after = await cdp.evaluate("document.querySelector('.hero-sub').innerText");
    console.log(`  熬夜前 ${before} → 熬夜后 ${after}`);

    // AI 重排一套：没配密钥时应提示并保留本地方案
    await cdp.evaluate(`document.getElementById('btnAiPlan').click(); 'ok'`);
    await sleep(20000);
    const planToast = await cdp.evaluate("document.getElementById('toast')?.innerText || ''");
    const planSource = await cdp.evaluate("document.querySelector('.ai-note b')?.innerText || ''");
    console.log('  点AI重排：', planToast, '｜方案来源：', planSource);
    await cdp.shot(path.join(OUT_DIR, '2-today.png'));

    // 改状态后 AI 方案应失效，回到本地规则
    await cdp.evaluate(`document.querySelector('#stateChips .chip[data-state="normal"]').click(); 'ok'`);
    await sleep(700);
    const afterState = await cdp.evaluate("document.querySelector('.ai-note b')?.innerText || ''");
    const stateToast = await cdp.evaluate("document.getElementById('toast')?.innerText || ''");
    const minutesNow = await cdp.evaluate("document.querySelectorAll('#trainingBox .metric .v')[1].innerText");
    console.log(`  切回正常后：${afterState}｜时长 ${minutesNow} 分钟｜提示：${stateToast}`);
    await cdp.evaluate(`document.querySelector('#stateChips .chip[data-state="tired"]').click(); 'ok'`);
    await sleep(400);

    // 3) AI 教练：说一句话，看是否有回应
    await cdp.evaluate(`
      const t=document.getElementById('coachText');
      t.value='今天室友点了炸鸡，我吃了两块，晚上还想吃夜宵';
      document.getElementById('coachSend').click(); 'ok';
    `);
    await sleep(12000);
    const coachReply = await cdp.evaluate("document.querySelector('.bubble.ai:last-child')?.innerText || ''");
    console.log('  教练回复：', coachReply.replace(/\s+/g, ' ').slice(0, 50));
    await cdp.shot(path.join(OUT_DIR, '3-coach.png'));

    // 4) 食堂页：导入内置菜库 + 生成搭配
    await cdp.evaluate(`document.querySelector('nav button[data-tab="canteen"]').click(); 'ok'`);
    await cdp.evaluate(`document.getElementById('btnBuiltin').click(); 'ok'`);
    await sleep(1200);
    const dishCount = await cdp.evaluate("document.getElementById('dishCount').innerText");
    console.log('  菜品数：', dishCount);
    await cdp.shot(path.join(OUT_DIR, '4-canteen.png'));

    // 走一次真实的"选图 → 识别"，验证结果表格排版
    const b64 = await readFile(path.join(OUT_DIR, 'menu-test.b64'), 'utf8');
    await cdp.evaluate(`(async () => {
      const res = await fetch(${JSON.stringify(b64)});
      const blob = await res.blob();
      const file = new File([blob], 'menu.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const inp = document.getElementById('gal');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change'));
      return 'ok';
    })()`);
    await sleep(20000);
    const aiRows = await cdp.evaluate("document.querySelectorAll('.ai-row').length");
    const aiNames = await cdp.evaluate("[...document.querySelectorAll('.ai-row .ai-name')].map(e=>e.innerText).join('/')");
    console.log(`  识别结果行数：${aiRows}｜${aiNames}`);
    await cdp.shot(path.join(OUT_DIR, '4b-ai-result.png'));

    // 今日页：让 AI 配三餐
    await cdp.evaluate(`document.querySelector('nav button[data-tab="today"]').click(); 'ok'`);
    await sleep(500);
    const hasMealBtn = await cdp.evaluate("Boolean(document.getElementById('btnAiMeals'))");
    await cdp.evaluate(`document.getElementById('btnAiMeals')?.click(); 'ok'`);
    await sleep(20000);
    const mealSource = await cdp.evaluate("document.querySelector('#todayMeals .ai-note b')?.innerText || '无'");
    const mealTotal = await cdp.evaluate("[...document.querySelectorAll('#todayMeals p.muted')].pop()?.innerText || ''");
    console.log(`  AI配餐按钮：${hasMealBtn ? '有' : '无'}｜来源：${mealSource}｜${mealTotal}`);
    await cdp.shot(path.join(OUT_DIR, '4c-ai-meals.png'));

    // 5) 打卡页：按推荐填入午餐并出分
    await cdp.evaluate(`document.querySelector('nav button[data-tab="log"]').click(); 'ok'`);
    await sleep(300);
    await cdp.evaluate(`document.querySelector('[data-fill="lunch"]').click(); 'ok'`);
    await sleep(300);
    await cdp.evaluate(`document.querySelector('[data-fill="dinner"]').click(); 'ok'`);
    await sleep(400);

    // 手动添加：点“手动添加”应展开内联表单（不再弹 prompt）
    await cdp.evaluate(`document.querySelector('[data-manual="breakfast"]').click(); 'ok'`);
    await sleep(250);
    const hasForm = await cdp.evaluate("Boolean(document.getElementById('m-name-breakfast'))");
    await cdp.evaluate(`
      (() => {
        const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
        set('m-name-breakfast','豆浆 + 水煮蛋'); set('m-kcal-breakfast',240);
        set('m-protein-breakfast',14); set('m-fat-breakfast',9);
        document.querySelector('[data-save="breakfast"]').click();
        return 'ok';
      })();
    `);
    await sleep(350);
    const bfText = await cdp.evaluate("document.querySelectorAll('.meal')[0].innerText.replace(/\\n/g,' ')");
    console.log('  手动添加表单：', hasForm ? '已展开' : '未展开', '｜早餐记录：', bfText.slice(0, 40));
    const score = await cdp.evaluate("document.querySelector('.score-ring div')?.innerText || '无'");
    console.log('  今日评分：', score);
    await cdp.shot(path.join(OUT_DIR, '5-log.png'));

    // 6) 趋势图：造 5 天历史后重新加载
    const seeded = await cdp.evaluate(`(() => {
      const k=Object.keys(localStorage).find(x=>x.startsWith('canteen-fit-v1')) || 'canteen-fit-v1';
      const s=JSON.parse(localStorage.getItem(k) || '{}');
      s.history=[5,4,3,2,1].map((d,i)=>({
        date:new Date(Date.now()-d*864e5).toISOString().slice(0,10),
        kcal:[1980,1720,1610,1840,1290][i], target:1773,
        protein:[70,92,101,85,102][i], fat:[70,58,52,66,48][i],
        score:[62,74,81,71,88][i], state:'normal', trainingDone:i%2===0
      }));
      s.history.reverse();
      localStorage.setItem(k, JSON.stringify(s));
      return s.history.length;
    })()`);
    const reloaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.reload', {});
    await reloaded;
    await sleep(900);
    await cdp.evaluate(`document.querySelector('nav button[data-tab="log"]').click(); 'ok'`);
    await sleep(500);
    const trendDrawn = await cdp.evaluate("document.getElementById('trendHint').innerText");
    console.log(`  历史 ${seeded} 天，趋势图提示：`, trendDrawn);
    await cdp.shot(path.join(OUT_DIR, '6-trend.png'));

    // 7) 保存当天记录 → 自动进入下一天
    await cdp.evaluate(`document.querySelector('nav button[data-tab="log"]').click(); 'ok'`);
    await sleep(250);
    const dayBefore = await cdp.evaluate("document.querySelector('.daybar-l b')?.innerText || '无'");
    await cdp.evaluate(`document.getElementById('saveDay').click(); 'ok'`);
    await sleep(600);
    const dayAfter = await cdp.evaluate("document.querySelector('.daybar-l b')?.innerText || '无'");
    const logCleared = await cdp.evaluate("!document.getElementById('logMeals').innerText.includes('豆浆')");
    const histCount = await cdp.evaluate("document.querySelectorAll('#historyBox .item').length");
    const backBtn = await cdp.evaluate("Boolean(document.getElementById('btnBackToday'))");
    console.log(`  保存后日期：${dayBefore} → ${dayAfter}｜当日已清空：${logCleared}｜历史条数：${histCount}｜回到今天按钮：${backBtn}`);
    await cdp.shot(path.join(OUT_DIR, '7-nextday.png'));

    // 别的页面是否跟着换日期
    await cdp.evaluate(`document.querySelector('nav button[data-tab="today"]').click(); 'ok'`);
    await sleep(300);
    const heroLabel = await cdp.evaluate("document.querySelector('.hero-label').innerText");
    const coachKept = await cdp.evaluate("document.getElementById('coachLog').innerText.includes('炸鸡')");
    console.log('  切日后教练对话是否还在：', coachKept ? '还在（不对）' : '已清空');
    const mealsHint = await cdp.evaluate("document.getElementById('todayMeals').innerText.slice(0, 18)");
    await cdp.evaluate(`document.querySelector('nav button[data-tab="canteen"]').click(); 'ok'`);
    await sleep(300);
    const dishDay = await cdp.evaluate("document.getElementById('dishDay').innerText");
    const dishN = await cdp.evaluate("document.getElementById('dishCount').innerText");
    console.log(`  今日页日期：${heroLabel}｜食堂页：${dishDay} ${dishN}｜三餐：${mealsHint}`);
    await cdp.shot(path.join(OUT_DIR, '8-nextday-today.png'));

    // 8) 清空菜单：第一次点击进入待确认，第二次真正清空（不依赖原生 confirm）
    await cdp.evaluate(`document.querySelector('nav button[data-tab="canteen"]').click(); 'ok'`);
    await sleep(300);
    const inheritedN = await cdp.evaluate("document.getElementById('dishCount').innerText");
    console.log('  新的一天菜单（应为沿用）：', inheritedN);
    await cdp.evaluate(`document.getElementById('btnClearDishes').click(); 'ok'`);
    await sleep(300);
    const armedText = await cdp.evaluate("document.getElementById('btnClearDishes').innerText");
    await cdp.shot(path.join(OUT_DIR, '7-armed.png'));
    await cdp.evaluate(`document.getElementById('btnClearDishes').click(); 'ok'`);
    await sleep(400);
    const afterClear = await cdp.evaluate("document.getElementById('dishCount').innerText");
    const toastText = await cdp.evaluate("document.getElementById('toast')?.innerText || ''");
    console.log('  第一次点击按钮变为：', armedText, '｜清空后：', afterClear, '｜提示：', toastText);

    // 清空菜单不该影响已打卡的记录
    await cdp.evaluate(`document.querySelector('nav button[data-tab="log"]').click(); 'ok'`);
    await sleep(300);
    const keptMeals = await cdp.evaluate("document.getElementById('historyBox').innerText.includes('10-20')");
    console.log('  清空菜单后历史记录是否还在：', keptMeals ? '在' : '没了');
    await cdp.shot(path.join(OUT_DIR, '7-cleared.png'));

    // 9a) 在模拟出来的 10-21 上也存一天，制造"未来数据"
    await cdp.evaluate(`document.querySelector('[data-manual="lunch"]').click(); 'ok'`);
    await sleep(250);
    await cdp.evaluate(`(() => {
      const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
      set('m-name-lunch','演示午餐'); set('m-kcal-lunch',600);
      set('m-protein-lunch',30); set('m-fat-lunch',20);
      document.querySelector('[data-save="lunch"]').click();
      return 'ok';
    })()`);
    await sleep(500);
    await cdp.evaluate(`document.getElementById('saveDay').click(); 'ok'`);
    await sleep(800);
    const histWithFuture = await cdp.evaluate("document.querySelectorAll('#historyBox .item').length");
    console.log('  在模拟日期存一天后，历史条数：', histWithFuture);

    // 9b) 回到今天 → 当天记录应原样还原
    await cdp.evaluate(`document.querySelector('nav button[data-tab="log"]').click(); 'ok'`);
    await sleep(300);
    await cdp.evaluate(`document.getElementById('btnBackToday').click(); 'ok'`);
    await sleep(800);
    const restored = await cdp.evaluate("document.getElementById('logMeals').innerText.includes('豆浆')");
    const dayNow = await cdp.evaluate("document.querySelector('.daybar-l b')?.innerText || ''");
    const histAfter = await cdp.evaluate("document.querySelectorAll('#historyBox .item').length");
    const hasFuture = await cdp.evaluate("document.getElementById('historyBox').innerText.includes('10-21')");
    console.log(`  回到今天：${dayNow}｜记录还原：${restored ? '是' : '否'}｜历史条数：${histAfter}｜还有未来日期：${hasFuture ? '有（不对）' : '已清理'}`);
    await cdp.shot(path.join(OUT_DIR, '9-back-today.png'));

    // 10) 运行时错误
    const errors = await cdp.evaluate('window.__errs ? window.__errs.length : 0');
    console.log('  运行时错误计数：', errors);
    console.log('  原生弹窗次数：', nativeDialogs, nativeDialogs ? '（应为 0）' : '');

    ws.close();
  } finally {
    proc.kill();
  }
};

main().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});
