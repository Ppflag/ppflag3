// 引擎自测：node test/engine.test.mjs
import assert from 'node:assert/strict';
import {
  bmr, tdee, bmi, validateGoal, dailyBudget, optimizeMeals, trainingPlan, scoreDay, sumIntake,
} from '../public/engine.js';

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

const base = { sex: 'female', age: 20, heightCm: 165, weightKg: 62, targetWeightKg: 57, activity: 'light' };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

ok('BMR 计算落在合理区间', () => {
  const v = bmr({ sex: 'female', age: 20, heightCm: 165, weightKg: 62 });
  assert.ok(v > 1250 && v < 1500, `得到 ${v}`);
});

ok('TDEE 高于 BMR', () => {
  const b = bmr(base);
  assert.ok(tdee(b, 'light') > b);
});

ok('BMI 计算正确', () => {
  assert.equal(bmi({ heightCm: 170, weightKg: 68 }).toFixed(1), '23.5');
});

ok('BMI < 18.5 直接拦截', () => {
  const g = validateGoal({ sex: 'female', age: 20, heightCm: 170, weightKg: 50, targetWeightKg: 45, targetDate: inDays(60) });
  assert.equal(g.blocked, true);
});

ok('目标日期过急时给出提醒与建议日期', () => {
  const g = validateGoal({ ...base, targetDate: inDays(10) });
  const w = g.warnings.find((x) => x.suggest);
  assert.ok(w, '应有一条带 suggest 的警告');
  assert.ok(w.suggest.suggestedDate);
});

ok('目标健康时不报警', () => {
  const g = validateGoal({ ...base, targetDate: inDays(90) });
  assert.equal(g.warnings.length, 0);
  assert.equal(g.ok, true);
});

ok('每日目标不低于安全下限', () => {
  const b = dailyBudget({ ...base, targetDate: inDays(15) });
  const floor = Math.max(b.bmr * 1.1, 1200);
  assert.ok(b.targetKcal >= floor - 1, `${b.targetKcal} < ${floor}`);
});

ok('熬夜时缺口自动缩小', () => {
  const normal = dailyBudget({ ...base, targetDate: inDays(60), state: 'normal' });
  const tired = dailyBudget({ ...base, targetDate: inDays(60), state: 'tired' });
  assert.ok(tired.deficit < normal.deficit);
  assert.ok(tired.targetKcal > normal.targetKcal);
});

ok('疲惫不适时训练降级为恢复', () => {
  const p = trainingPlan({ state: 'unwell', minutes: 40, streak: 0 });
  assert.equal(p.level, '恢复');
  assert.ok(p.minutes >= 8);
});

ok('食堂搭配能覆盖三餐且不超目标太多', () => {
  const dishes = [
    { id: '1', name: '米饭', category: 'staple', meals: ['lunch', 'dinner'], kcal: 230, protein: 4, fat: 1, carb: 51 },
    { id: '2', name: '卤鸡胸肉', category: 'protein', meals: ['lunch', 'dinner'], kcal: 180, protein: 30, fat: 6, carb: 2 },
    { id: '3', name: '清炒时蔬', category: 'veg', meals: ['lunch', 'dinner'], kcal: 80, protein: 3, fat: 5, carb: 7 },
    { id: '4', name: '水煮蛋', category: 'protein', meals: ['breakfast'], kcal: 70, protein: 6, fat: 5, carb: 1 },
    { id: '5', name: '燕麦粥', category: 'staple', meals: ['breakfast'], kcal: 150, protein: 6, fat: 4, carb: 24 },
  ];
  const b = dailyBudget({ ...base, targetDate: inDays(60) });
  const opt = optimizeMeals(dishes, b);
  for (const k of ['breakfast', 'lunch', 'dinner']) {
    assert.ok(opt.meals[k].items.length > 0, `${k} 没有结果`);
  }
  assert.ok(opt.totals.kcal <= b.targetKcal * 1.25, `合计 ${opt.totals.kcal} 超出太多`);
  assert.ok(opt.totals.protein >= b.protein * 0.6, `蛋白 ${opt.totals.protein} 过低`);
});

ok('打分在 0–100 之间且超量会扣分', () => {
  const b = dailyBudget({ ...base, targetDate: inDays(60) });
  const good = scoreDay({ kcal: b.targetKcal, protein: b.protein, fat: b.fat, carb: b.carb }, b, 3);
  const bad = scoreDay({ kcal: b.targetKcal * 1.5, protein: b.protein * 0.4, fat: b.fat * 1.8, carb: 0 }, b, 1);
  assert.ok(good.total > 90, `达标日 ${good.total}`);
  assert.ok(bad.total < 60, `超量日 ${bad.total}`);
  assert.ok(bad.tips.length > 0);
});

ok('sumIntake 能汇总', () => {
  const s = sumIntake([
    { kcal: 100, protein: 10, fat: 2, carb: 5 },
    { kcal: 200, protein: 20, fat: 4, carb: 10 },
  ]);
  assert.equal(s.kcal, 300);
  assert.equal(s.protein, 30);
});

console.log(`\n${pass}/12 通过`);
