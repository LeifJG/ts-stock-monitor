// portproxy.js — Node.js TCP relay for WSL2 localhost forwarding
// Forwards localhost traffic to the WSL2 Next.js server
// Windows→WSL2 portproxy fix

const net = require("net");
const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = 3000;
const RELAY_PORT = 3001;

const server = net.createServer((clientSocket) => {
  const targetSocket = net.connect(TARGET_PORT, TARGET_HOST, () => {
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  targetSocket.on("error", (err) => {
    console.error("target error:", err.message);
    clientSocket.destroy();
  });

  clientSocket.on("error", (err) => {
    targetSocket.destroy();
  });
});

server.listen(RELAY_PORT, "0.0.0.0", () => {
  console.log(`relay listening on 0.0.0.0:${RELAY_PORT} → ${TARGET_HOST}:${TARGET_PORT}`);
});
