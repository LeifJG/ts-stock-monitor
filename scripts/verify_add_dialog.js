// verify_add_dialog.js — 验证添加持仓弹窗支持港股5位码（无第三方依赖）
// 用法同 verify_table_screenshot.js：Windows node 跑，Edge headless 9222
const PORT = 9222;
const BASE_URL = "http://172.28.248.8:3000/";
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
    new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  await send("Page.enable");
  return { ws, send };
}

(async () => {
  const { ws, send } = await cdpConnect();
  await send("Page.navigate", { url: BASE_URL });
  await sleep(6000); // 等页面渲染

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return r.result?.result?.value;
  };

  // 1. 找「添加持仓」按钮并点击
  const clicked = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => x.textContent.includes('添加持仓'));
    if (b) { b.click(); return true; }
    return false;
  })()`);
  await sleep(1500);

  // 2. 弹窗打开后，查股票代码输入框的 placeholder
  const info = await evalJs(`(() => {
    const dlg = document.querySelector('.ant-modal-content') || document.querySelector('.ant-modal');
    if (!dlg) return { open: false };
    const input = [...dlg.querySelectorAll('input')].find(i => i.closest('.ant-form-item')?.textContent.includes('股票代码'));
    const label = [...dlg.querySelectorAll('.ant-form-item-label label')].map(l => l.textContent).join('|');
    return { open: true, placeholder: input ? input.placeholder : null, maxLength: input ? input.maxLength : null, labels: label };
  })()`);

  console.log(JSON.stringify({ clicked, ...info }, null, 2));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
