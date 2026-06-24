#!/usr/bin/env node
/**
 * wsl-port-relay.js — 在 WSL 内部监听 3001 端口，
 * 将流量转发到 172.28.248.8:3000（WSL IP）。
 * Windows 通过 172.28.248.8:3001 即可访问。
 * 
 * 或者：监听 0.0.0.0:3000 做本地端口转发（解决 portproxy 的 HTTP 问题）
 */
const net = require('net');
const TARGET = '172.28.248.8';
const PORT = 3000;

// 在 3001 端口创建 TCP 转发（不会和 3000 冲突）
const server = net.createServer((clientSocket) => {
  const targetSocket = new net.Socket();
  
  targetSocket.connect(PORT, TARGET, () => {
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  targetSocket.on('error', (err) => {
    console.error('Target error:', err.message);
    clientSocket.destroy();
  });

  clientSocket.on('error', (err) => {
    console.error('Client error:', err.message);
    targetSocket.destroy();
  });
});

server.listen(3001, '0.0.0.0', () => {
  console.log('WSL Port Relay running on 0.0.0.0:3001 -> ' + TARGET + ':' + PORT);
});
