// ============================================================
// localhost-proxy.js — HTTP 本地转发代理
// 监听 0.0.0.0:3002，用标准 HTTP 协议转发到 Next.js 服务器
// 用于解决 Windows netsh portproxy 对 HTTP 流量转发失败的问题
// ============================================================
const http = require('http');

const TARGET_HOST = '172.28.248.8';
const TARGET_PORT = 3000;
const LISTEN_PORT = 3002;

const server = http.createServer((clientReq, clientRes) => {
  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    clientRes.end('Bad Gateway: ' + err.message);
  });

  clientReq.pipe(proxyReq);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`HTTP Proxy running on 0.0.0.0:${LISTEN_PORT} → ${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`Access via: http://localhost:${LISTEN_PORT} (use portproxy to forward 3000→${LISTEN_PORT})`);
});
