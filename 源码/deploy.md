# 部署指南

目标只有一个：**评委在微信里点开链接，三秒内看到首页**。

---

## 先看清约束

| 约束 | 影响 |
|---|---|
| 密钥必须留在服务端 | 不能做纯静态托管，必须跑 Node 进程 |
| 评委在国内、用微信打开 | 海外 PaaS（Render / Railway / Vercel）冷启动 30 秒，**直接否决** |
| 只剩 10 天 | 域名备案要 7–20 天，**来不及**；只能用免备案的地址 |
| 只有 1 个服务、无数据库 | 单容器就够，不需要集群 |

结论：**要一个国内的、免备案的、带 HTTPS 的地址。**

---

## 三条路线，按推荐顺序

| 路线 | 免备案 | 国内速度 | 成本 | 上手难度 | 适合 |
|---|---|---|---|---|---|
| **A. 腾讯云 CloudBase 云托管** | ✅ 用平台默认域名 | 快 | 按量，几分钱/天 | 中 | **首选** |
| **B. 香港轻量服务器 + 自有域名** | ✅（境外服务器无需备案） | 中（延迟 50–120ms） | 约 30–60 元/月 | 中高 | A 走不通时 |
| **C. cloudflared 临时隧道** | ✅ | 慢，且依赖你电脑开机 | 免费 | 低 | 只做演示兜底 |

---

## 路线 A：腾讯云 CloudBase 云托管（推荐）

### 1. 准备

```bash
# 在项目根目录打包；不要把 .env、data、shots 打进上传包
cd 项目根目录
```

项目里已经有 `Dockerfile` 和 `.dockerignore`。`.env`、`data/`、截图、测试和 Vercel 文件不会进镜像。
当前 `server.js` 内置了 DeepSeek key；如果代码仓库是公开的，请先把仓库设为 Private 或改用 `AI_API_KEY` 环境变量。

### 2. 开通

1. 注册腾讯云、完成**实名认证**（个人即可）
2. 搜索「云开发 CloudBase」→ 开通，创建一个环境（按量计费，选最低配）
3. 进入「云托管」→ 新建服务

### 3. 部署

任选一种：

- **上传代码包**：把 `canteen-fit` 目录打成 zip（**删掉 `.env` 和 `shots`**）后上传，平台会按 `Dockerfile` 构建
- **镜像**：本地 `docker build -t canteen-fit:1.0 .`，推到腾讯云容器镜像服务，再从云托管拉取

关键配置：

| 项 | 值 |
|---|---|
| 容器端口 / 服务端口 | `80` |
| 构建目录 | 项目根目录（有 `Dockerfile`、`package.json`、`public/` 的那一层） |
| 启动命令 | `npm start`（Dockerfile 已设置，通常不用再填） |
| 健康检查路径 | `/api/health` |
| 最小实例数 | `1`（别设 0，否则冷启动要等） |
| CPU / 内存 | 0.25 核 / 0.5G 够用 |

> 端口不要填 3000。Dockerfile 已设置 `ENV PORT=80`，`server.js` 读取 `process.env.PORT`，云托管把流量转到 80。
> 如果平台强制注入其他 `PORT`，以平台环境变量为准，不需要改代码。

### 4. 环境变量

默认已经内置 DeepSeek Flash，不填也能用。要覆盖时再设置：

```text
AI_BASE_URL = https://api.deepseek.com
AI_API_KEY  = sk-你的密钥
AI_MODEL    = deepseek-flash
COOKIE_SECURE = 1
```

`COOKIE_SECURE=1` 用于 CloudBase 的 HTTPS 域名；本地 http 调试不要设置。

账号持久化二选一：

- **CloudBase 持久存储 / CFS 挂载到 `/app/data`**，再设置 `DATA_DIR=/app/data`
- 或使用 Upstash Redis，设置 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`

不配置持久存储也能打开，但容器重启后账号会丢失。

### 5. 拿地址

部署完成后平台会给一个默认域名，形如：

```
https://xxxx-xxxx.sh.run.tcloudbase.com
```

**这个域名自带 HTTPS、无需备案**，直接就是可以发给评委的链接。

### 6. 验收

```bash
curl https://你的域名/api/health
# 期望：{"ok":true,"ai":true,"model":"deepseek-flash"}

curl -I https://你的域名/
# 期望：200，Content-Type: text/html; charset=utf-8
```

打开首页应直接显示「轻宿」页面，而不是源码或乱码。

### 7. 常见失败排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开是源码 / 下载文件 | 静态目录没有复制进镜像，或入口不是 `server.js` | 确认 Dockerfile 复制了 `public`，并执行 `npm start` |
| 页面乱码 | 响应缺少 UTF-8 或文件被二次编码 | 当前 `server.js` 的 MIME 已带 `charset=utf-8`，重新构建镜像 |
| 502 / 连接拒绝 | 容器没有监听平台端口 | 服务端口填 `80`；Dockerfile 已设置 `PORT=80` |
| 首页 404 | 构建目录选错 | 构建目录选项目根目录，不是 `public` |
| 登录后马上掉线 | 容器重启，内存会话丢失 | 挂 CFS 到 `/app/data` 并设 `DATA_DIR=/app/data`，或配 Redis |
| AI 报错 | key 失效/余额不足 | 看容器日志；页面会自动降级本地回复 |

然后**用手机微信打开这个域名**，走一遍全流程。

---

## 路线 B：香港轻量服务器（免备案 + 自有域名）

适合你想用自己的域名、或者 CloudBase 审核卡住时。

### 1. 买机器

腾讯云/阿里云的「香港轻量应用服务器」，1 核 2G，装 **Ubuntu 22.04**。

### 2. 装环境

```bash
# 服务器上
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx
sudo npm i -g pm2
```

### 3. 传代码并启动

```bash
# 本地
scp -r canteen-fit root@你的IP:/opt/

# 服务器上
cd /opt/canteen-fit
cat > .env <<'EOF'
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_API_KEY=sk-你的密钥
AI_MODEL=qwen3-vl-plus
PORT=3000
EOF

pm2 start server.js --name canteen-fit
pm2 save && pm2 startup
```

### 4. Nginx 反代 + HTTPS

```nginx
server {
    listen 80;
    server_name 你的域名.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;   # AI 生成可能要 20 秒
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/canteen-fit /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 你的域名.com   # 自动签 HTTPS 证书
```

> ⚠️ `proxy_read_timeout` 一定要调大。默认 60 秒，AI 配餐 + 重试可能超过。

### 5. 域名

买个域名（约 30 元/年），把 A 记录指向香港服务器 IP。**境外服务器不需要备案。**

---

## 路线 C：cloudflared 临时隧道（只做兜底）

5 分钟能拿到一个 HTTPS 公网地址，但**依赖你电脑开着**。

```powershell
# 1. 下载 cloudflared-windows-amd64.exe 并重命名为 cloudflared.exe
#    https://github.com/cloudflare/cloudflared/releases/latest

# 2. 本地起服务（另开一个窗口）
node server.js

# 3. 开隧道
.\cloudflared.exe tunnel --url http://localhost:3000
```

输出一个 `https://xxx-yyy.trycloudflare.com`。

**不要把这个当提交链接**——你电脑一关就失效。只用于临时给同学看。

---

## 部署后必做的 5 项验收

| # | 检查 | 通过标准 |
|---|---|---|
| 1 | `curl 域名/api/health` | `"ai":true` |
| 2 | 手机微信打开 | 3 秒内出首页，不转圈 |
| 3 | 点「拍照识别」 | 能调起相机并返回菜品 |
| 4 | 点「让 AI 排一套」 | 20 秒内出结果（超时说明机器太弱或没配 key） |
| 5 | 连续点两次「保存并进入下一天」 | 历史与趋势正常 |

---

## 五个常见坑

1. **实例数设成 0** → 第一个访问的人要等 30 秒冷启动。**最小实例必须 ≥ 1**。
2. **忘记配环境变量** → 页面一切正常，AI 接口失败时会自动使用本地科普回复，页头仍显示「AI 双助手」。
3. **Nginx 超时太短** → 配餐或排课报 504。`proxy_read_timeout` 调到 120s。
4. **把 `.env` 打进 zip 上传** → 密钥泄露到平台构建日志里。用 `.dockerignore` 挡掉。
5. **用自有域名但没备案** → 国内服务器会被拦。要么用平台默认域名，要么换香港机器。

---

## 密钥轮换提醒

密钥曾经出现在对话记录里。部署完成后建议：

1. 去百炼控制台**新建一个 key**
2. 平台环境变量换成新 key
3. 旧 key 删除

演示当天若发现额度异常，也是同样的操作。

---

## 关于登录（v1.1 新增）

### 做了什么

- 账号密码注册/登录，密码用 **PBKDF2-SHA256（12 万次迭代）+ 随机盐**存储，不存明文
- 会话用 **HttpOnly Cookie**，7 天过期，服务端内存保存
- **所有 AI 接口都要登录**（`/api/health` 除外）——公开链接不会被陌生人刷额度
- 每个账号的数据按 `userId` 隔离在浏览器本地

### 两个环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATA_DIR` | `./data` | 用户表 `users.json` 存放目录 |
| `COOKIE_SECURE` | 不设 | 设为 `1` 时 Cookie 带 `Secure`。**只有全站 https 才开**，否则登录会失败 |

### ⚠️ 必须知道的限制：容器重启会丢账号

云托管的容器文件系统是**临时的**。重新部署或实例重建后，`data/users.json` 会消失 —— 所有人要重新注册。

三个选择：

1. **接受它**（推荐给比赛）：评委不会重启你的容器，演示期间是安全的。说明书里写明"演示版"。
2. **挂持久卷**：云托管支持挂载 CFS 文件存储，把 `DATA_DIR` 指到挂载点，约 20 分钟配置。
3. **换云开发数据库**：账号存 CloudBase 数据库，彻底持久化，但要接 SDK，约 1 天。

### 另一个限制：数据不同步

登录只解决"身份"，**不解决"多设备同步"**。同一个账号在手机和电脑上登录，记录各自独立——因为业务数据还在浏览器 localStorage。

这是刻意保留的边界：体重、作息这类敏感数据不上传服务器。答辩时这样回答：

> 登录解决的是"谁在用"和"AI 额度不被滥用"；数据同步需要后端数据库，属于下一阶段。我们选择先把敏感数据留在设备上。

---

## 关于特殊健康状况模块（v1.8 新增）

- 入口：登录后首页二选一 → **特殊健康状况**，跳转 `public/health.html`
- 独立结果页：`public/health-result.html`，不引用减脂 `app.js` / `engine.js`
- 纯前端 + JSON：食谱、食物规则、康复生活指导都在 `public/health-data.json`，共 14 个病种；**不需要新数据库**
- 食物照片、分餐记录、打分、近 7 天趋势、AI 对话都存在浏览器本地：
  - `canteen-health-setup::<userId>`
  - `canteen-health-meals::<userId>::<conditionId>`
  - `canteen-health-chat::<userId>::<conditionId>`
- 新增病种：改 JSON 的 `categories`（加 `status: "active"`）和 `conditions`（加同 id 详情与 `rehab`），无需改页面
- 固定免责文案写在页面与 JSON 的 `meta.disclaimer`，不要删除

### 双 AI 接口

特殊健康状况与减脂运动使用两个独立接口：

- `POST /api/chat-diet`：膳食健康 AI，SSE 流式；`mode=recognize` 时返回食物图片识别 JSON
- `POST /api/chat-sport`：减脂运动 AI，SSE 流式；读取档案、目标体重、活动量、目标日期和可用时间
- 两套系统提示词完全独立
- `server.js` 内置 DeepSeek Flash 默认配置；图片识别使用 `deepseek-v4-flash-vision-exp`
- 接口报错、余额不足或 key 失效时，自动降级为本地科普回复；页面不显示错误连接状态
- 可用 `.env` 的 `AI_BASE_URL / AI_API_KEY / AI_MODEL` 覆盖内置配置
- 膳食 AI 的本地降级文案在 `public/health-chat.js`；运动 AI 的本地降级在 `public/app.js`

> 生产环境建议把 key 改回环境变量，不要长期硬编码在源码里。

---

## Vercel 部署（v2.0）

Vercel 无持久磁盘，原 `data/users.json` 不能用于线上账号。项目已经补上：

- `vercel.json`：静态目录 `public` + `api/*.js` Serverless 函数
- `api/[...path].js`：把 `/api/*` 转交给现有 `handleRequest`
- `auth.js`：检测到 Upstash Redis 环境变量时，自动把用户和会话存 Redis；本地仍写 JSON

### 步骤

1. 把项目推到 GitHub。
2. Vercel Dashboard → **Storage / Marketplace** → 创建 **Upstash Redis**，连接到该项目。
3. Vercel → **Add New Project** → 导入 GitHub 仓库。
4. 如果项目不在仓库根目录，设置 **Root Directory**。
5. Framework Preset 选 **Other**；Build Command 和 Output Directory 会从 `vercel.json` 读取：
   - Build Command: `node tools/build.mjs`
   - Output Directory: `public`
6. 确认环境变量中出现 `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`（或 `KV_REST_API_URL`、`KV_REST_API_TOKEN`）。
7. Deploy，拿到 `https://<project>.vercel.app`。

### 说明

- `server.js` 内置 DeepSeek key，不需要在 Vercel 再填 AI key；需要换 key 时加 `AI_API_KEY` 环境变量覆盖。
- 线上 Cookie 会自动带 `Secure`（Vercel 环境）。
- 不配 Redis 也能打开页面，但账号会在冷启动/重新部署后丢失，不建议这样上线。
- AI 接口是 SSE 流式响应；Vercel Hobby 的冷启动和 60 秒上限可能导致第一次回复稍慢，失败时会自动使用本地科普回复。
- 如果你的 Vercel 账号在国内访问不稳定，优先考虑国内云托管或 Render/Railway 的 Docker + 持久盘方案。

### 本地继续运行

```bash
node server.js
```

本地没有 Redis 时仍使用 `data/users.json`，行为与之前一致。
