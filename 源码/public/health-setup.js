// health-setup.js —— 特殊健康状况：信息采集与病种选择
import {
  getSessionUser, loadHealthData, loadSetup, saveSetup, escapeHtml, toast,
} from './health-common.js';

const $ = (id) => document.getElementById(id);
let data = null;
let selectedId = '';
let user = null;

function renderConditionGroups() {
  const box = $('conditionGroups');
  const groups = [];
  for (const cat of data.categories || []) {
    const cards = (cat.conditions || [])
      .map((c) => {
        const active = c.status === 'active';
        const on = active && c.id === selectedId;
        return `<button type="button" class="condition-card ${on ? 'on' : ''} ${active ? '' : 'disabled'}"
          data-id="${escapeHtml(c.id)}" ${active ? '' : 'disabled aria-disabled="true"'}>
          <span class="condition-name">${escapeHtml(c.name)}</span>
          <span class="condition-meta">${active ? escapeHtml(c.tag || '可用') : '即将上线'}</span>
          ${on ? '<span class="condition-check">✓</span>' : ''}
        </button>`;
      })
      .join('');
    groups.push(`
      <div class="condition-group">
        <div class="condition-group-head">
          <b>${escapeHtml(cat.name)}</b>
          <span>${escapeHtml(cat.desc || '')}</span>
        </div>
        <div class="condition-grid">${cards}</div>
      </div>`);
  }
  box.innerHTML = groups.join('') + `
    <div class="selected-condition" id="selectedCondition">
      ${selectedId ? `已选择：<b>${escapeHtml(currentLabel())}</b>` : '请选择一个健康情况'}
    </div>`;

  box.querySelectorAll('.condition-card:not(.disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedId = btn.dataset.id;
      renderConditionGroups();
    });
  });
}

function currentLabel() {
  for (const cat of data.categories || []) {
    const c = (cat.conditions || []).find((x) => x.id === selectedId);
    if (c) return c.name;
  }
  return '';
}

function fillForm(profile) {
  if (!profile) return;
  $('sex').value = profile.sex || '';
  $('age').value = profile.age ?? '';
  $('heightCm').value = profile.heightCm ?? '';
  $('weightKg').value = profile.weightKg ?? '';
  $('activity').value = profile.activity || 'light';
}

function readForm() {
  const sex = $('sex').value;
  const age = Number($('age').value);
  const heightCm = Number($('heightCm').value);
  const weightKg = Number($('weightKg').value);
  const activity = $('activity').value;

  if (!sex) throw new Error('请选择性别');
  if (!Number.isFinite(age) || age < 14 || age > 90) throw new Error('年龄请填写 14–90 岁');
  if (!Number.isFinite(heightCm) || heightCm < 120 || heightCm > 230) throw new Error('身高请填写 120–230 cm');
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 250) throw new Error('体重请填写 30–250 kg');
  if (!activity) throw new Error('请选择日常活动量');
  if (!selectedId) throw new Error('请选择一个健康情况');
  if (!currentLabel()) throw new Error('请选择一个可用的健康情况');

  return { profile: { sex, age, heightCm, weightKg, activity }, conditionId: selectedId };
}

async function main() {
  user = await getSessionUser();
  if (!user) return;

  try {
    data = await loadHealthData();
  } catch (e) {
    $('conditionGroups').innerHTML = `<div class="card"><div class="alert danger" style="margin:0">${escapeHtml(e.message)}</div></div>`;
    return;
  }

  const saved = loadSetup(user.id);
  if (saved && saved.profile) fillForm(saved.profile);
  if (saved && saved.conditionId && data.conditions[saved.conditionId]) {
    const meta = (data.categories || [])
      .flatMap((c) => c.conditions || [])
      .find((c) => c.id === saved.conditionId);
    if (meta && meta.status === 'active') selectedId = saved.conditionId;
  }
  renderConditionGroups();

  $('setupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const payload = readForm();
      saveSetup(user.id, payload);
      location.href = './health-result.html';
    } catch (err) {
      toast(err.message);
    }
  });
}

main();
