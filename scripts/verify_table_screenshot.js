// verify_table_screenshot.js — 表格 UI 截图验证（无第三方依赖）
// 原理：Windows node 原生 WebSocket 驱动 Windows 侧 headless Edge 的 CDP。
// 为什么绕这一圈：Chrome/Edge 的 DevTools 端口只绑 Windows 回环，WSL(NAT)够不到，
// 所以脚本必须用 Windows node 跑；WSL localhost 转发对 headless 不生效，故用局域网 IP。
// 用法：
//   1) Windows 侧起 headless Edge（PowerShell）:
//      Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -ArgumentList '--headless','--remote-debugging-port=9222','--user-data-dir=C:\temp\edge-profile','--no-first-run','--disable-gpu','about:blank'
//   2) /mnt/d/nvm4w/nodejs/node.exe 'C:\temp\verify_table_screenshot.js'（先拷到 C:\temp）
//   3) 截图输出 C:\temp\表格-新版-主表.png / -展开行.png；用完 Stop-Process 杀 Edge
// 注意：脚本内 URL 需为 WSL 局网 IP（hostname -I），不是 localhost。

const fs = require("fs");
const PORT = 9222;
const OUT = "C:\\temp";
const BASE_URL = "http://172.28.248.8:3000/"; // WSL 局网 IP，重启后可能变化
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpConnect() {
  let list = null;
  for (let i = 0; i < 30; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (list.length) break;
    } catch {}
    await sleep(500);
  }
  if (!list || !list.length) throw new Error("DevTools 端口不可达");
  let page = list.find((t) => t.type === "page");
  if (!page) {
    page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, (m) => res(m.result || m.error));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, close: () => ws.close() };
}

(async () => {
  const c = await cdpConnect();
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.navigate", { url: BASE_URL });

  // 等表格行渲染（React 水合 + 行情数据）
  let ok = false;
  for (let i = 0; i < 90; i++) {
    const r = await c.send("Runtime.evaluate", { expression: `!!document.querySelector('.ant-table-row')`, returnByValue: true });
    if (r.result && r.result.value === true) { ok = true; break; }
    await sleep(1000);
  }
  if (!ok) throw new Error("表格行未渲染");
  await sleep(2000);

  async function shotElement(selector, file) {
    await c.send("Runtime.evaluate", { expression: `document.querySelector('${selector}')?.scrollIntoView({block:'start'})` });
    await sleep(800);
    const r = await c.send("Runtime.evaluate", {
      expression: `JSON.stringify((s=>{if(!s)return null;const b=s.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};})(document.querySelector('${selector}')))`,
      returnByValue: true,
    });
    if (!r.result.value) throw new Error("元素不存在: " + selector);
    const box = JSON.parse(r.result.value);
    const shot = await c.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.ceil(box.w), height: Math.ceil(box.h), scale: 1 },
      captureBeyondViewport: true,
    });
    fs.writeFileSync(`${OUT}\\${file}`, Buffer.from(shot.data, "base64"));
    console.log("saved:", file);
  }

  // 横向溢出检查
  const ov = await c.send("Runtime.evaluate", {
    expression: `(function(){const w=document.querySelector('.ant-table-container');return w?(w.scrollWidth>w.clientWidth?('H-SCROLL '+w.scrollWidth+'>'+w.clientWidth):'no-h-scroll'):'no-table';})()`,
    returnByValue: true,
  });
  console.log("主表横向检查:", ov.result.value);
  await shotElement(".ant-table-wrapper", "表格-新版-主表.png");

  // 展开第一行 → 指标条 + 面板
  await c.send("Runtime.evaluate", { expression: `document.querySelector('.ant-table-row-expand-icon')?.click()` });
  ok = false;
  for (let i = 0; i < 20; i++) {
    const r = await c.send("Runtime.evaluate", {
      expression: `(function(){const e=document.querySelector('.ant-table-expanded-row');return !!e&&e.clientHeight>50;})()`,
      returnByValue: true,
    });
    if (r.result && r.result.value === true) { ok = true; break; }
    await sleep(1000);
  }
  if (!ok) throw new Error("展开行未出现");
  await sleep(2500); // 等估值/股东面板数据
  await shotElement(".ant-table-expanded-row", "表格-新版-展开行.png");

  c.close();
  console.log("done");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
