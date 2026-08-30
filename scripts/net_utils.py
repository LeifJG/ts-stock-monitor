#!/usr/bin/env python3
"""
net_utils.py — 项目共享网络工具（P1-6：消灭失效代理 IP 硬编码）
------------------------------------------------------------
背景：网关 IP 随 WSL 重启变化（曾为 192.168.124.11 / 172.28.240.1），
旧脚本硬编码导致 systemd 环境下代理全挂。

策略（与用户全局代理策略一致）：
  - 直连优先：国内行情源（腾讯/东财/新浪/cninfo）直连即可
  - 需要代理时动态探测 Windows Clash（默认网关:7890），探测失败=直连
  - setup_proxy_env(): 给 akshare/requests 类调用用（走环境变量）
  - http_get(): 给裸 urllib 调用用（直连优先，失败回退代理）
"""

import os
import socket
import subprocess
import time

_PROXY_CACHE: tuple[float, str | None] | None = None
_CACHE_TTL = 300  # 探测结果缓存 5 分钟


def clash_proxy(timeout: float = 1.0) -> str | None:
    """动态探测 Windows Clash 代理（默认网关:7890），5 分钟内复用结果"""
    global _PROXY_CACHE
    now = time.time()
    if _PROXY_CACHE and now - _PROXY_CACHE[0] < _CACHE_TTL:
        return _PROXY_CACHE[1]
    proxy: str | None = None
    try:
        out = subprocess.run(
            ["ip", "route"], capture_output=True, text=True, timeout=3
        ).stdout
        for line in out.splitlines():
            if line.startswith("default"):
                gw = line.split()[2]
                try:
                    with socket.create_connection((gw, 7890), timeout=timeout):
                        proxy = f"http://{gw}:7890"
                except Exception:
                    proxy = None
                break
    except Exception:
        proxy = None
    _PROXY_CACHE = (now, proxy)
    return proxy


def setup_proxy_env() -> None:
    """若环境未设代理，探测 Clash 并写入环境变量（幂等，尊重已有值）。
    供 akshare/requests 内部走 requests 的脚本在 import 后调用一次。"""
    if os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY"):
        return
    p = clash_proxy()
    if p:
        for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            os.environ[k] = p


def http_get(url: str, timeout: int = 15) -> bytes:
    """直连优先（显式绕过环境代理变量），失败回退 Clash 代理重试一次"""
    import urllib.request

    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        return opener.open(url, timeout=timeout).read()
    except Exception:
        proxy = clash_proxy()
        if not proxy:
            raise
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
        return opener.open(url, timeout=timeout).read()
