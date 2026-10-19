import { createHash } from "node:crypto";
import { credentialFingerprintSource } from "./credentials";

// Upper bound on tracked fixed-window keys. When the map is full, the oldest
// entry is evicted so a key-spraying caller cannot grow memory without bound.
// Eviction resets the evicted key's window (documented trade-off).
const MAX_TRACKED_KEYS = 10_000;

// Sentinel used when a request carries no resolvable client IP. It is combined
// with the credential fingerprint so that callers without an IP are still
// distinguished by their credential rather than collapsing onto one bucket.
const NO_IP_SENTINEL = "no-ip";

export interface FixedWindowResult {
	allowed: boolean;
	retryAfterMs: number;
}

export interface FixedWindowLimiter {
	check(key: string, now?: number): FixedWindowResult;
	reset(): void;
}

interface WindowState {
	count: number;
	windowStart: number;
}

/**
 * Derives a stable limiter key for a request.
 *
 * The key is a SHA-256 hex digest of the caller's credential fingerprint (never
 * the raw token) plus the client IP. When no `x-forwarded-for` / `x-real-ip`
 * header is present, the IP component falls back to a fixed sentinel so the
 * credential fingerprint still discriminates callers. Requests that have
 * neither a credential nor an IP therefore share a single bucket; that is the
 * explicit, documented trade-off for unauthenticated, IP-less traffic.
 */
export function callerKey(request: Request): string {
	const forwardedFor = request.headers.get("x-forwarded-for");
	const firstHop = forwardedFor?.split(",")[0]?.trim();
	const realIp = request.headers.get("x-real-ip")?.trim();
	const ip = firstHop || realIp || NO_IP_SENTINEL;

	const credential = credentialFingerprintSource(request) ?? "";

	return createHash("sha256").update(`${credential}\u0000${ip}`).digest("hex");
}

export function createFixedWindowLimiter(
	limit: number,
	windowMs: number,
): FixedWindowLimiter {
	const windows = new Map<string, WindowState>();

	return {
		check(key: string, now: number = Date.now()): FixedWindowResult {
			const existing = windows.get(key);

			if (!existing || now - existing.windowStart >= windowMs) {
				if (!existing && windows.size >= MAX_TRACKED_KEYS) {
					const oldest = windows.keys().next().value;
					if (oldest !== undefined) {
						windows.delete(oldest);
					}
				}
				windows.set(key, { count: 1, windowStart: now });
				return { allowed: true, retryAfterMs: 0 };
			}

			if (existing.count >= limit) {
				return {
					allowed: false,
					retryAfterMs: existing.windowStart + windowMs - now,
				};
			}

			existing.count += 1;
			return { allowed: true, retryAfterMs: 0 };
		},
		reset(): void {
			windows.clear();
		},
	};
}
