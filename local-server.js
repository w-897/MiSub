/**
 * 本地开发服务器 - 简化版
 * 直接实现核心 API 端点,无需复杂的模块导入
 */

import { Miniflare } from 'miniflare';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动本地开发服务器...\n');

// 完整的 Worker 脚本,包含所有必要的 API 端点
const workerScript = `
// 简单的 Cookie 解析
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    cookies[name] = decodeURIComponent(value);
  });
  return cookies;
}

// 创建认证 Cookie
function createAuthCookie(env) {
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7天
  return \`auth_token=authenticated; Path=/; HttpOnly; SameSite=Lax; Expires=\${expires.toUTCString()}\`;
}

// 检查认证状态
function isAuthenticated(request) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  return cookies.auth_token === 'authenticated';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true'
    };
    
    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { 
        status: 204,
        headers: corsHeaders 
      });
    }
    
    try {
      // ========== 登录端点 ==========
      if (path === '/api/login' && request.method === 'POST') {
        const { password } = await request.json();
        
        if (password === env.ADMIN_PASSWORD) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Set-Cookie': createAuthCookie(env)
            }
          });
        }
        
        return new Response(JSON.stringify({ error: '密码错误' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // ========== 登出端点 ==========
      if (path === '/api/logout') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Set-Cookie': 'auth_token=; Path=/; HttpOnly; Max-Age=0'
          }
        });
      }
      
      // ========== 获取数据端点 ==========
      if (path === '/api/data' && request.method === 'GET') {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 从 KV 读取数据
        const subscriptions = await env.MISUB_KV.get('misub_subscriptions_v1', 'json') || [];
        const profiles = await env.MISUB_KV.get('misub_profiles_v1', 'json') || [];
        const config = await env.MISUB_KV.get('worker_settings_v1', 'json') || {};
        
        return new Response(JSON.stringify({
          misubs: subscriptions,
          profiles: profiles,
          config: config
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // ========== 保存数据端点 ==========
      if (path === '/api/misubs' && request.method === 'POST') {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        const { misubs, profiles } = await request.json();
        
        // 保存到 KV
        await env.MISUB_KV.put('misub_subscriptions_v1', JSON.stringify(misubs));
        await env.MISUB_KV.put('misub_profiles_v1', JSON.stringify(profiles));
        
        return new Response(JSON.stringify({ 
          success: true,
          message: '数据保存成功'
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // ========== 调试端点 ==========
      if (path === '/api/debug') {
        return new Response(JSON.stringify({
          message: '本地开发服务器运行中',
          hasKV: !!env.MISUB_KV,
          hasAdminPassword: !!env.ADMIN_PASSWORD,
          authenticated: isAuthenticated(request),
          timestamp: new Date().toISOString()
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // ========== 健康检查 ==========
      if (path === '/health') {
        return new Response('OK', { 
          status: 200,
          headers: corsHeaders
        });
      }
      
      // ========== 节点分组 API ==========
      if (path === '/api/node-groups') {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        const KV_KEY_NODE_GROUPS = 'misub_node_groups_v1';
        
        // GET - 获取所有分组
        if (request.method === 'GET') {
          const groups = await env.MISUB_KV.get(KV_KEY_NODE_GROUPS, 'json') || [];
          return new Response(JSON.stringify({ success: true, data: groups }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // POST - 创建或更新分组
        if (request.method === 'POST') {
          const body = await request.json();
          const groups = await env.MISUB_KV.get(KV_KEY_NODE_GROUPS, 'json') || [];
          
          // 验证
          if (!body.name || !body.name.trim()) {
            return new Response(JSON.stringify({ success: false, message: '分组名称不能为空' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          if (!body.nodeIds || !Array.isArray(body.nodeIds) || body.nodeIds.length === 0) {
            return new Response(JSON.stringify({ success: false, message: '至少选择一个节点' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          const now = new Date().toISOString();
          
          if (body.id) {
            // 更新现有分组
            const index = groups.findIndex(g => g.id === body.id);
            if (index === -1) {
              return new Response(JSON.stringify({ success: false, message: '分组不存在' }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            const duplicateName = groups.some((g, i) => i !== index && g.name.trim() === body.name.trim());
            if (duplicateName) {
              return new Response(JSON.stringify({ success: false, message: '分组名称已存在' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            groups[index] = {
              ...groups[index],
              name: body.name.trim(),
              description: body.description?.trim() || '',
              nodeIds: body.nodeIds,
              enabled: body.enabled !== false,
              updatedAt: now
            };
          } else {
            // 创建新分组
            const duplicateName = groups.some(g => g.name.trim() === body.name.trim());
            if (duplicateName) {
              return new Response(JSON.stringify({ success: false, message: '分组名称已存在' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            const newGroup = {
              id: 'group-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
              name: body.name.trim(),
              description: body.description?.trim() || '',
              nodeIds: body.nodeIds,
              enabled: body.enabled !== false,
              createdAt: now,
              updatedAt: now
            };
            groups.push(newGroup);
          }
          
          await env.MISUB_KV.put(KV_KEY_NODE_GROUPS, JSON.stringify(groups));
          return new Response(JSON.stringify({ 
            success: true, 
            message: body.id ? '分组已更新' : '分组创建成功',
            data: groups 
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // DELETE - 删除分组
        if (request.method === 'DELETE') {
          const groupId = url.searchParams.get('id');
          if (!groupId) {
            return new Response(JSON.stringify({ success: false, message: '缺少分组ID' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          const groups = await env.MISUB_KV.get(KV_KEY_NODE_GROUPS, 'json') || [];
          const index = groups.findIndex(g => g.id === groupId);
          
          if (index === -1) {
            return new Response(JSON.stringify({ success: false, message: '分组不存在' }), {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          groups.splice(index, 1);
          await env.MISUB_KV.put(KV_KEY_NODE_GROUPS, JSON.stringify(groups));
          
          return new Response(JSON.stringify({ 
            success: true, 
            message: '分组已删除',
            data: groups 
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }
      
      // 默认响应
      return new Response(JSON.stringify({
        message: 'MiSub 本地开发服务器',
        endpoints: {
          'POST /api/login': '用户登录',
          'GET /api/logout': '用户登出',
          'GET /api/data': '获取数据',
          'POST /api/misubs': '保存数据',
          'GET /api/node-groups': '获取节点分组',
          'POST /api/node-groups': '创建/更新节点分组',
          'DELETE /api/node-groups?id=xxx': '删除节点分组',
          'GET /api/debug': '调试信息'
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('API Error:', error);
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
}
`;

// 创建 Miniflare 实例
const mf = new Miniflare({
  script: workerScript,
  modules: true,
  kvNamespaces: ['MISUB_KV'],
  kvPersist: path.join(__dirname, '.wrangler/state/kv'),
  port: 8787,
  host: '127.0.0.1',
  bindings: {
    ADMIN_PASSWORD: 'admin123',
    COOKIE_SECRET: 'local-dev-secret-key'
  }
});

console.log('✅ 服务器配置完成');
console.log('📦 KV 存储:', path.join(__dirname, '.wrangler/state/kv'));
console.log('🌐 地址: http://localhost:8787');
console.log('');
console.log('🔑 登录密码: admin123');
console.log('');
console.log('📡 API 端点:');
console.log('   POST /api/login        - 登录');
console.log('   GET  /api/data         - 获取数据');
console.log('   POST /api/misubs       - 保存数据');
console.log('   GET  /api/node-groups  - 获取节点分组');
console.log('   POST /api/node-groups  - 创建/更新分组');
console.log('   DEL  /api/node-groups  - 删除分组');
console.log('   GET  /api/debug        - 调试信息');
console.log('');
console.log('按 Ctrl+C 停止\n');

await mf.ready;
console.log('✅ 服务器就绪!\n');

process.on('SIGINT', async () => {
  console.log('\n👋 关闭中...');
  await mf.dispose();
  process.exit(0);
});
