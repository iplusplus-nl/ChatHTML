import { isIP } from "node:net";
import type { Request, RequestHandler } from "express";

type Counter = { count: number; resetAt: number };

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function requestIp(req: Request): string {
  const remote = req.socket.remoteAddress ?? "";
  const loopback =
    remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const nginxClientIp = req.get("x-real-ip")?.trim() ?? "";
  if (loopback && isIP(nginxClientIp)) {
    return nginxClientIp;
  }
  return req.ip || remote || "unknown";
}

export function createRateLimit(options: {
  key(req: Request): string;
  max?: number;
  windowMs?: number;
  scope: string;
}): RequestHandler {
  const max = options.max ?? positiveInteger(process.env.CHATHTML_API_RATE_LIMIT_PER_MINUTE, 300);
  const windowMs = options.windowMs ?? 60_000;
  const counters = new Map<string, Counter>();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${options.scope}:${options.key(req)}`;
    let counter = counters.get(key);
    if (!counter || counter.resetAt <= now) {
      counter = { count: 0, resetAt: now + windowMs };
      counters.set(key, counter);
    }
    counter.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - counter.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(counter.resetAt / 1_000)));
    if (counter.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((counter.resetAt - now) / 1_000))));
      res.status(429).json({
        error: "Too many requests. Try again later.",
        code: "RATE_LIMITED"
      });
      return;
    }
    if (counters.size > 20_000) {
      for (const [candidateKey, candidate] of counters) {
        if (candidate.resetAt <= now) counters.delete(candidateKey);
      }
    }
    next();
  };
}

export function createConcurrencyLimit(options: {
  key(req: Request): string;
  max?: number;
  exclusive?(req: Request): boolean;
}): RequestHandler {
  const max =
    options.max ??
    positiveInteger(process.env.CHATHTML_ACCOUNT_CONCURRENT_REQUESTS, 8);
  const active = new Map<string, number>();
  const exclusive = new Set<string>();
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const key = options.key(req);
    const count = active.get(key) ?? 0;
    const isExclusive = options.exclusive?.(req) ?? false;
    if (exclusive.has(key) || (isExclusive && count > 0) || count >= max) {
      res.setHeader("Retry-After", "2");
      res.status(429).json({
        error: isExclusive
          ? "Wait for current account operations before deleting the account."
          : "Too many concurrent account operations.",
        code: "CONCURRENCY_LIMITED"
      });
      return;
    }
    if (isExclusive) exclusive.add(key);
    active.set(key, count + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = (active.get(key) ?? 1) - 1;
      if (remaining > 0) active.set(key, remaining);
      else active.delete(key);
      if (isExclusive) exclusive.delete(key);
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}
