// 分餐打分与趋势自测：node test/health-score.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scoreMeal, scoreDay, trendData, mealShare } from '../public/health-score.js';

const data = JSON.parse(await readFile(new URL('../public/health-data.json', import.meta.url), 'utf8'));
const c = data.conditions.hyperlipidemia;
const target = 1700;
let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
};

ok('推荐搭配得到较高单餐分', () => {
  const s = scoreMeal(c, 'lunch', { text: '杂粮饭、清蒸鱼、西兰花、豆腐汤', kcal: 430 }, target);
  assert.ok(s.score >= 70, `score=${s.score}`);
  assert.equal(s.forbidden.length, 0);
  assert.ok(s.recommend.length >= 2);
  assert.ok(s.comment.length > 5);
});

ok('禁忌食物会显著扣分并给出替换建议', () => {
  const good = scoreMeal(c, 'lunch', { text: '杂粮饭、清蒸鱼、西兰花', kcal: 430 }, target);
  const bad = scoreMeal(c, 'lunch', { text: '杂粮饭、清蒸鱼、猪肝', kcal: 430 }, target);
  assert.ok(bad.score < good.score, `${bad.score} !< ${good.score}`);
  assert.ok(bad.forbidden.length >= 1);
  assert.ok(bad.comment.includes('不符') || bad.comment.includes('替换'));
});

ok('全天三餐按权重汇总并保持覆盖度', () => {
  const entries = [
    { date: '2026-11-14', meal: 'breakfast', text: '燕麦、鸡蛋、牛奶', kcal: 360, score: 86, hits: [] },
    { date: '2026-11-14', meal: 'lunch', text: '杂粮饭、清蒸鱼、西兰花', kcal: 430, score: 82, hits: [] },
    { date: '2026-11-14', meal: 'dinner', text: '红薯、鸡胸、菠菜', kcal: 380, score: 88, hits: [] },
  ];
  const day = scoreDay(c, entries, target, '2026-11-14');
  assert.equal(day.covered, 3);
  assert.ok(day.score >= 80 && day.score <= 90, `score=${day.score}`);
  assert.equal(day.totalKcal, 1170);
  assert.ok(day.evaluation.length > 10);
  assert.ok(mealShare(c, 'lunch') > mealShare(c, 'dinner'));
});

ok('近 7 天趋势返回 7 个点，最后一个是今天', () => {
  const list = trendData(c, [], target, 7);
  assert.equal(list.length, 7);
  assert.equal(list[list.length - 1].label, '今天');
  assert.equal(list.filter((x) => x.score !== null).length, 0);
});

console.log(`\n${pass}/4 通过`);
