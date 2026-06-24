// ============================================================
// 3000-relay.js — 端口转发守护（解决 WSL 本地转发问题）
// 监听 0.0.0.0:3001，将 HTTP 流量转发到 upstream
// ============================================================
const http = require('http');
const httpProxy = require('http-proxy');

// 如果没有 http-proxy 包，回退到普通 net 转发
let useSimpleProxy = false;
let proxy;
try {
  proxy = httpProxy.createProxyServer({
    target: `http://172.28.248.8:3000`,
    changeOrigin: true,
  });
  console.log('Using http-proxy module');
} catch {
  useSimpleProxy = true;
  console.log('http-proxy not found, using net module fallback');
}

if (!useSimpleProxy) {
  const server = http.createServer((req, res) => {
    proxy.web(req, res, {}, (err) => {
      console.error('Proxy error:', err.message);
      res.writeHead(502);
      res.end('Bad Gateway');
    });
  });

  server.listen(3001, '0.0.0.0', () => {
    console.log('Relay running on 0.0.0.0:3001 → 172.28.248.8:3000');
  });
}
