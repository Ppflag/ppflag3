// 特殊健康状况数据自测：node test/health-data.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../public/health-data.json', import.meta.url), 'utf8'));

let pass = 0;
const ok = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
};

const active = [];
const reserved = [];
for (const cat of data.categories) {
  for (const c of cat.conditions) (c.status === 'active' ? active : reserved).push({ ...c, cat: cat.id });
}

ok('三个大类都存在', () => {
  assert.deepEqual(data.categories.map((c) => c.id), ['chronic', 'postop', 'oncology']);
});

ok('已上线病种为 14 个，预留扩展位为 0 个', () => {
  assert.equal(active.length, 14);
  assert.equal(reserved.length, 0);
});

ok('新增的 8 个病种都有独立详情', () => {
  for (const id of ['hyperlipidemia', 'gout', 'ckd', 'meniscus', 'ankle', 'lumbar', 'tumor_postop', 'radio_chemo']) {
    assert.ok(data.conditions[id], `${id} 缺少详情`);
    assert.ok(data.conditions[id].meals.length === 3, `${id} 餐次不足`);
    assert.ok(data.conditions[id].foods.length >= 10, `${id} 食物规则不足`);
  }
});

ok('高血脂/痛风/肾病包含关键忌口', () => {
  const fat = data.conditions.hyperlipidemia.foods.map((f) => f.name).join('|');
  assert.ok(fat.includes('动物内脏') && fat.includes('油炸食品'));
  const gout = data.conditions.gout.foods.map((f) => f.name).join('|');
  assert.ok(gout.includes('浓肉汤') && gout.includes('啤酒'));
  const ckd = data.conditions.ckd.foods.map((f) => f.name).join('|');
  assert.ok(ckd.includes('低钠盐') && ckd.includes('加工肉'));
  assert.ok(data.conditions.ckd.summary.includes('医护'));
});

ok('三个运动术后病种都有明确的活动限制', () => {
  for (const id of ['meniscus', 'ankle', 'lumbar']) {
    const avoid = data.conditions[id].avoidActivity.join('|');
    assert.ok(avoid.length > 8, `${id} 缺少活动限制`);
  }
  assert.ok(data.conditions.lumbar.avoidActivity.join('|').includes('弯腰搬重物'));
});

ok('肿瘤术后与放化疗病种强调高蛋白和食品安全', () => {
  for (const id of ['tumor_postop', 'radio_chemo']) {
    const c = data.conditions[id];
    assert.ok(c.principles.join('|').includes('高蛋白') || c.summary.includes('优质蛋白'));
    assert.ok(c.summary.includes('彻底加热'));
  }
  const radio = data.conditions.radio_chemo.foods.map((f) => f.name).join('|');
  assert.ok(radio.includes('刺身') && radio.includes('隔夜菜'));
});

ok('三餐快捷食物库完整并带预设热量', () => {
  const p = data.meta.mealPresets;
  assert.ok(p && p.breakfast && p.lunch && p.dinner);
  for (const key of ['breakfast', 'lunch', 'dinner']) {
    assert.ok(p[key].length >= 8, `${key} 快捷食物不足`);
    for (const f of p[key]) {
      assert.ok(f.name && Number(f.kcal) > 0, `${key} ${f.name} 缺少热量`);
    }
  }
});

ok('14 个病种都有独立的康复生活指导', () => {
  for (const c of active) {
    const r = data.conditions[c.id].rehab;
    assert.ok(r, `${c.id} 缺少 rehab`);
    for (const key of ['exercise', 'avoid', 'routine', 'sleep', 'hydration', 'daily', 'mood', 'monitor']) {
      assert.ok(r[key], `${c.id} 缺少 ${key}`);
      assert.ok(Array.isArray(r[key].items) && r[key].items.length >= 2, `${c.id} ${key} 条目不足`);
    }
    assert.ok(r.intro.length >= 10, `${c.id} 缺少康复说明`);
  }
});

ok('每个已上线病种都有三餐、食物规则和活动建议', () => {
  for (const c of active) {
    const d = data.conditions[c.id];
    assert.ok(d, `${c.id} 缺少详情`);
    assert.equal(d.meals.length, 3, `${c.id} 餐次不足`);
    assert.ok(d.foods.length >= 10, `${c.id} 食物规则不足`);
    assert.ok(d.activity.items.length >= 2, `${c.id} 活动建议不足`);
    assert.ok(d.avoidActivity.length >= 2, `${c.id} 需避开的项目不足`);
    assert.ok(d.contraindications.length >= 2, `${c.id} 注意事项不足`);
  }
});

ok('食物标签只有三档', () => {
  for (const c of active) {
    for (const f of data.conditions[c.id].foods) {
      assert.ok(['forbidden', 'limit', 'recommend'].includes(f.tag), `${c.id} ${f.name} 标签非法`);
      assert.ok(f.name && f.amount, `${c.id} 食物缺少名称或建议量`);
    }
  }
});

ok('化疗期严格包含生冷/未加热禁忌', () => {
  const foods = data.conditions.leukemia_chemo.foods.map((f) => f.name).join('|');
  for (const w of ['刺身', '溏心蛋', '生拌菜', '隔夜菜', '现榨果汁']) assert.ok(foods.includes(w), `缺少 ${w}`);
});

ok('ACL 术后明确避开跳跃、急停、负重深蹲', () => {
  const avoid = data.conditions.acl.avoidActivity.join('|');
  for (const w of ['跳跃', '急停', '负重深蹲']) assert.ok(avoid.includes(w), `缺少 ${w}`);
});

ok('固定免责文案存在且包含关键边界', () => {
  assert.ok(data.meta.disclaimer.includes('膳食、运动科普参考'));
  assert.ok(data.meta.disclaimer.includes('不能替代医生、营养师、康复师方案'));
  assert.ok(data.meta.disclaimer.includes('患有基础疾病请遵从医嘱'));
  assert.ok(data.meta.disclaimer.includes('不提供诊疗服务'));
});

ok('白血病化疗期和休养期食谱是两套独立数据', () => {
  const a = JSON.stringify(data.conditions.leukemia_chemo.meals);
  const b = JSON.stringify(data.conditions.leukemia_rest.meals);
  assert.notEqual(a, b);
});

console.log(`\n${pass}/14 通过`);
