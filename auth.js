// auth.js —— 账号与会话
// 本地开发：用户表写 JSON 文件，会话存在内存。
// Vercel：自动使用 Upstash Redis REST（配置 UPSTASH_REDIS_REST_URL/TOKEN 或 KV_REST_API_URL/TOKEN），
// 用户和会话都持久化，避免 Serverless 冷启动丢账号。

import crypto from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ITERATIONS = 120000;
const KEY_LEN = 32;
const DIGEST = 'sha256';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 天
const PREFIX = 'qingsu:';

const hashPassword = (password, saltHex) =>
  crypto.pbkdf2Sync(String(password), Buffer.from(saltHex, 'hex'), ITERATIONS, KEY_LEN, DIGEST).toString('hex');

function redisConfig() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  return url && token ? { url, token } : null;
}

export function createAuth({ dir = './data' } = {}) {
  const usersFile = path.join(dir, 'users.json');
  const sessions = new Map(); // 本地开发用；Vercel 会改用 Redis
  let users = [];
  let loaded = false;
  const redisCfg = redisConfig();

  if (process.env.VERCEL && !redisCfg) {
    console.warn('[auth] Vercel 环境未配置 Upstash Redis，账号将无法持久化；请按 deploy.md 配置。');
  }

  async function redis(command, ...args) {
    if (!redisCfg) throw new Error('Redis 未配置');
    const resp = await fetch(redisCfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisCfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([command, ...args]),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error || `Redis ${resp.status}`);
    return data.result;
  }

  const userKey = (name) => `${PREFIX}user:${String(name).toLowerCase()}`;
  const idKey = (id) => `${PREFIX}userid:${id}`;
  const sidKey = (sid) => `${PREFIX}sid:${sid}`;

  async function loadOnce() {
    if (loaded || redisCfg) return;
    loaded = true;
    try {
      const raw = await readFile(usersFile, 'utf8');
      const parsed = JSON.parse(raw);
      users = Array.isArray(parsed.users) ? parsed.users : [];
    } catch {
      users = [];
    }
  }

  async function persist() {
    if (redisCfg) return;
    await mkdir(dir, { recursive: true });
    const tmp = usersFile + '.tmp';
    await writeFile(tmp, JSON.stringify({ users }, null, 2), 'utf8');
    await rename(tmp, usersFile);
  }

  const publicUser = (u) => ({ id: u.id, username: u.username, createdAt: u.createdAt });

  async function register(username, password) {
    const name = String(username || '').trim();
    if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(name)) throw new Error('用户名 2–20 位，可以是中文、字母、数字、下划线');
    if (String(password || '').length < 6) throw new Error('密码至少 6 位');

    if (redisCfg) {
      if (await redis('GET', userKey(name))) throw new Error('这个用户名已经被用了');
      const salt = crypto.randomBytes(16).toString('hex');
      const user = {
        id: crypto.randomUUID(),
        username: name,
        salt,
        hash: hashPassword(password, salt),
        createdAt: new Date().toISOString(),
      };
      const ok = await redis('SET', userKey(name), JSON.stringify(user), 'NX');
      if (ok !== 'OK') throw new Error('这个用户名已经被用了');
      await redis('SET', idKey(user.id), JSON.stringify(user));
      return publicUser(user);
    }

    await loadOnce();
    if (users.some((u) => u.username.toLowerCase() === name.toLowerCase())) throw new Error('这个用户名已经被用了');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: crypto.randomUUID(),
      username: name,
      salt,
      hash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    try {
      await persist();
    } catch (e) {
      console.error('[auth] 用户写入失败（重启后会丢失）:', e.message);
    }
    return publicUser(user);
  }

  async function verify(username, password) {
    const name = String(username || '').trim().toLowerCase();
    let user = null;
    if (redisCfg) {
      const raw = await redis('GET', userKey(name));
      if (!raw) return null;
      try { user = JSON.parse(raw); } catch { return null; }
    } else {
      await loadOnce();
      user = users.find((u) => u.username.toLowerCase() === name) || null;
    }
    if (!user) return null;
    const hash = hashPassword(password, user.salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(user.hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return publicUser(user);
  }

  async function createSession(userId) {
    const sid = crypto.randomBytes(24).toString('hex');
    if (redisCfg) {
      await redis('SET', sidKey(sid), userId, 'EX', String(Math.floor(SESSION_TTL / 1000)));
    } else {
      sessions.set(sid, { userId, exp: Date.now() + SESSION_TTL });
    }
    return sid;
  }

  async function sessionUser(sid) {
    if (!sid) return null;
    if (redisCfg) {
      const userId = await redis('GET', sidKey(sid));
      if (!userId) return null;
      const raw = await redis('GET', idKey(userId));
      if (!raw) return null;
      try { return publicUser(JSON.parse(raw)); } catch { return null; }
    }
    const s = sessions.get(sid);
    if (!s) return null;
    if (s.exp < Date.now()) {
      sessions.delete(sid);
      return null;
    }
    const u = users.find((x) => x.id === s.userId);
    return u ? publicUser(u) : null;
  }

  async function destroySession(sid) {
    if (!sid) return;
    if (redisCfg) await redis('DEL', sidKey(sid));
    else sessions.delete(sid);
  }

  return { register, verify, createSession, sessionUser, destroySession, publicUser };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(sid, { secure = false, maxAge = SESSION_TTL / 1000 } = {}) {
  const parts = [
    `sid=${sid}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
