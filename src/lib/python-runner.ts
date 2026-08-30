// ============================================================
// src/lib/python-runner.ts — 共享的 Python 脚本调用模块
// 统一管理: 解释器解析(优先项目 .venv)、代理环境变量、调用参数
// 所有调用 Python 脚本的 API route 都应使用本模块，避免重复逻辑
// ============================================================

import { execSync, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
import * as path from "path";
import * as fs from "fs";

/** 默认代理（WSL 内 Clash） */
export const DEFAULT_PROXY = "http://192.168.124.11:7890";

/**
 * 解析要使用的 Python 解释器路径
 * 优先级: 环境变量 PYTHON_BIN > 项目 .venv/bin/python3 > 系统 python3
 */
export function resolvePythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;

  const venvPython = path.join(process.cwd(), ".venv", "bin", "python3");
  if (fs.existsSync(venvPython)) return venvPython;

  return "python3";
}

/** 安全拼接命令行参数（防止特殊字符破坏命令） */
function quoteArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * 运行 scripts/ 下的 Python 脚本，返回 stdout 字符串
 * @param scriptName 脚本文件名（如 fetch_insider.py）
 * @param args 传给脚本的参数列表
 * @param options.timeout 超时毫秒数（默认 20000）
 * @param options.env 额外环境变量
 */
export function runPythonScript(
  scriptName: string,
  args: string[] = [],
  options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}
): string {
  const scriptPath = path.join(process.cwd(), "scripts", scriptName);
  const cmdParts = [resolvePythonBin(), scriptPath, ...args].map(quoteArg);
  const cmd = cmdParts.join(" ");

  const env = {
    ...process.env,
    // 走代理访问国内行情源
    http_proxy: process.env.http_proxy || DEFAULT_PROXY,
    https_proxy: process.env.https_proxy || DEFAULT_PROXY,
    ...options.env,
  };

  return execSync(cmd, {
    encoding: "utf-8",
    timeout: options.timeout ?? 20000,
    env,
  });
}

/**
 * 异步运行 scripts/ 下的 Python 脚本（长任务用，不阻塞事件循环）
 * 供拉取多只股票K线等耗时场景（如 fetch_volatility.py）
 */
export async function runPythonScriptAsync(
  scriptName: string,
  args: string[] = [],
  options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<string> {
  const scriptPath = path.join(process.cwd(), "scripts", scriptName);
  const cmdParts = [resolvePythonBin(), scriptPath, ...args].map(quoteArg);
  const cmd = cmdParts.join(" ");

  const env = {
    ...process.env,
    http_proxy: process.env.http_proxy || DEFAULT_PROXY,
    https_proxy: process.env.https_proxy || DEFAULT_PROXY,
    ...options.env,
  };

  const { stdout } = await execAsync(cmd, {
    encoding: "utf-8",
    timeout: options.timeout ?? 120000,
    maxBuffer: 10 * 1024 * 1024,
    env,
  });
  return stdout;
}
