// Vercel Serverless 入口：所有 /api/* 请求交给现有的 Node 路由处理。
// 本地 node server.js 仍然使用原来的 HTTP 服务，不受影响。
import { handleRequest } from '../server.js';

export const config = {
  maxDuration: 60,
  memory: 1024,
};

export default async function handler(req, res) {
  return handleRequest(req, res);
}
