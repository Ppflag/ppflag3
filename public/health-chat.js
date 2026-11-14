// health-chat.js —— 特殊健康状况：纯前端本地营养师回复
// 不调用任何外部接口，只使用当前病种、当天三餐记录和用户问题生成科普回答。
import { scoreDay, matchFoods, MEAL_META } from './health-score.js';

const fruitWords = ['苹果', '香蕉', '橙子', '橙', '梨', '桃子', '油桃', '水蜜桃', '蓝莓', '樱桃', '猕猴桃', '西瓜', '葡萄', '柚', '草莓', '水果'];
const proteinWords = ['鸡蛋', '蛋', '鱼', '虾', '鸡', '鸭', '牛肉', '羊肉', '瘦肉', '肉', '豆腐', '豆干', '豆浆', '牛奶', '酸奶', '鸡胸'];

function someWord(text, words) {
  return words.filter((w) => String(text || '').includes(w));
}

function fruitAdvice(condition) {
  const rules = (condition.foods || []).filter((f) => {
    const keys = [f.name, ...(f.alias || [])].join('|');
    return fruitWords.some((w) => keys.includes(w));
  });
  const forbidden = rules.filter((f) => f.tag === 'forbidden').map((f) => f.name);
  const limit = rules.filter((f) => f.tag === 'limit').map((f) => f.name);
  const recommend = rules.filter((f) => f.tag === 'recommend').map((f) => f.name);
  if (forbidden.length) return `当前病种里，${forbidden.slice(0, 3).join('、')}属于不建议的水果，先避开。`;
  if (limit.length) return `${limit.slice(0, 3).join('、')}属于少吃类，注意一次一小份，不要榨汁。`;
  if (recommend.length) return `可以优先选${recommend.slice(0, 3).join('、')}这类水果，一次一小份。`;
  return '水果以新鲜、完整为主，一次一小份，尽量不榨汁。';
}

function conditionTip(condition, kind) {
  const id = condition.id;
  if (kind === 'protein') {
    if (id === 'ckd') return '肾病病种的蛋白总量要按医护或营养师方案，不要自行加蛋白粉。';
    if (id === 'gout') return '优先低脂奶、鸡蛋和适量豆腐，红肉和海鲜少量。';
    if (id === 'leukemia_chemo' || id === 'radio_chemo') return '优先鸡蛋羹、清蒸鱼、豆腐和瘦肉末，全部彻底煮熟。';
    if (id === 'acl' || id === 'meniscus' || id === 'ankle' || id === 'lumbar' || id === 'tumor_postop') return '术后恢复期每餐安排一掌心大小的优质蛋白，帮助维持体力。';
    if (id === 't1dm' || id === 't2dm') return '蛋白和主食一起吃，比单独吃主食更稳一些。';
    return '优先鱼、豆制品、鸡胸和鸡蛋，少选肥肉和加工肉。';
  }
  if (kind === 'fruit') {
    if (id === 'ckd') return '如果血钾偏高，水果种类和量要按化验结果和医护建议调整。';
    if (id === 't1dm' || id === 't2dm') return '放在两餐之间，一次一小份，不要用果汁代替。';
    if (id === 'leukemia_chemo' || id === 'radio_chemo') return '水果要去皮或蒸熟，不吃生冷和切开久放的。';
    if (id === 'gout') return '水果可以吃，但不要用果汁代替，控制总量。';
    return '每天大约 200g，分次吃，尽量选完整水果。';
  }
  return '';
}

function dayLine(day, target) {
  if (!day.covered) return '你今天还没有三餐记录，先记一餐我才能结合你的实际摄入来分析。';
  const remain = target - day.totalKcal;
  const kcalLine = remain < 0
    ? `今天已摄入约 ${day.totalKcal} kcal，比参考值多 ${Math.abs(remain)} kcal。`
    : `今天已摄入约 ${day.totalKcal} kcal，距离参考值还有约 ${remain} kcal。`;
  return `${kcalLine}已记录 ${day.covered}/3 餐，当前得分 ${day.score} 分。`;
}

export function generateNutritionReply({ condition, meals, question, image, target, date }) {
  const q = String(question || '').trim();
  const day = scoreDay(condition, meals, target, date);
  const photoLine = image
    ? '照片我收到了；仅凭照片很难准确判断油、盐和实际份量，我先结合你的病种和最近记录来说。'
    : '';
  const name = condition.name;

  const mealKey = /早餐/.test(q) ? 'breakfast' : /午餐/.test(q) ? 'lunch' : /晚餐/.test(q) ? 'dinner' : '';
  if (mealKey) {
    const meta = MEAL_META.find((m) => m.key === mealKey);
    const entry = day.meals.find((m) => m.key === mealKey)?.entry;
    if (entry) {
      const tags = [
        entry.forbidden?.length ? `禁忌：${entry.forbidden.slice(0, 3).join('、')}` : '',
        entry.limit?.length ? `少吃：${entry.limit.slice(0, 3).join('、')}` : '',
        entry.recommend?.length ? `推荐：${entry.recommend.slice(0, 3).join('、')}` : '',
      ].filter(Boolean).join('；');
      return `${photoLine}你记录的${meta.name}是「${entry.text}」，单餐 ${entry.score} 分（${entry.grade}）。${entry.comment}${tags ? `\n${tags}` : ''}\n具体份量仍以医护或营养师方案为准。`;
    }
    const ref = (condition.meals || []).find((m) => m.key === mealKey);
    const items = (ref?.items || []).map((x) => x.name).slice(0, 4).join('、');
    return `${photoLine}你今天还没有记录${meta.name}。参考食谱里这一餐可以选「${items || '主食 + 优质蛋白 + 蔬菜'}」，吃之前先按当前病种的禁食和少吃清单核对一下。`;
  }

  if (/蛋白|蛋白质|营养够|够不够|肉蛋奶|鸡蛋|鱼|豆腐|牛奶/.test(q)) {
    const texts = day.meals.filter((m) => m.entry).map((m) => m.entry.text).join('、');
    const rawFound = someWord(texts, proteinWords);
    const found = rawFound.filter((w) => !rawFound.some((other) => other !== w && other.includes(w)));
    const intro = found.length
      ? `今天记录里出现了 ${found.slice(0, 4).join('、')}，属于蛋白质来源。`
      : '今天的三餐记录里还没有明显看到优质蛋白。';
    return `${photoLine}${intro}${conditionTip(condition, 'protein')} 如果一餐里只有主食和蔬菜，可以加一个鸡蛋、一份豆腐或一小份鱼/鸡胸。`;
  }

  if (/水果|苹果|香蕉|橙|梨|桃|蓝莓|樱桃|猕猴桃|西瓜|葡萄/.test(q)) {
    return `${photoLine}${fruitAdvice(condition)}${conditionTip(condition, 'fruit')} 如果今天已经吃了水果，记得算进全天总热量里。`;
  }

  if (/热量|还能吃|吃多少|多少卡|kcal|能量/.test(q)) {
    return `${photoLine}${dayLine(day, target)} 下一餐可以先看剩余热量：如果剩得少，就选清蒸、炖煮和蔬菜；如果剩得多，再补一份主食和优质蛋白。具体热量只作参考，不要为了数字跳过正餐。`;
  }

  if (/禁忌|不能吃|可以吃|能吃|忌口|能不能/.test(q)) {
    const hits = matchFoods(condition, q);
    const forbidden = hits.filter((x) => x.tag === 'forbidden');
    const limit = hits.filter((x) => x.tag === 'limit');
    const recommend = hits.filter((x) => x.tag === 'recommend');
    if (forbidden.length) return `${photoLine}你问到的「${forbidden.map((x) => x.name).slice(0, 3).join('、')}」在当前病种里属于不建议的食物，先避开；可以换成同类清淡的推荐食材。`;
    if (limit.length) return `${photoLine}「${limit.map((x) => x.name).slice(0, 3).join('、')}」属于少吃类，注意份量和频率，不要一次吃太多。`;
    if (recommend.length) return `${photoLine}「${recommend.map((x) => x.name).slice(0, 3).join('、')}」属于当前病种的推荐方向，可以按建议量安排，但仍要看全天总量。`;
    return `${photoLine}当前是「${name}」，忌口以病种食物清单为准；先避开油炸、生冷不洁和来源不明的保健品，具体能不能吃可以用「食物检索」核对。`;
  }

  // 默认：结合当天记录、得分和病种原则
  const base = `${photoLine}你当前是「${name}」。${dayLine(day, target)}`;
  const issues = day.forbidden?.length ? `今天出现了「${day.forbidden.slice(0, 3).join('、')}」，下一餐优先避开。` : '';
  const principle = condition.principles?.[0] ? `日常原则：${condition.principles[0]}。` : '';
  const suggest = day.covered < 3
    ? '可以先把没记录的餐次补上，评分和趋势会更准确。'
    : day.score >= 85
      ? '整体搭配已经比较贴近当前病种的饮食规范，继续保持。'
      : '下一餐可以多选一份推荐蔬菜或优质蛋白，少选油炸和加工食品。';
  return `${base}${issues}${principle}${suggest} 具体方案仍以医护或营养师建议为准。`;
}
