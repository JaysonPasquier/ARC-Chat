const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_POLL_FAILURES = 4;
const LOGIN_ID_RE = /^[a-f0-9]{32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Cancelled"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Cancelled"));
      },
      { once: true },
    );
  });
}

async function postJson(url, body, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { ok: res.ok, status: res.status, data };
}

async function linkWithSteam({ serverUrl, openExternal, signal, onCode = () => {}, pollMs = POLL_MS, timeoutMs = TIMEOUT_MS }) {
  const origin = new URL(serverUrl).origin;

  let started;
  try {
    started = await postJson(`${origin}/auth/steam/start`, {}, signal);
  } catch {
    if (signal.aborted) throw new Error("Cancelled");
    throw new Error("Cannot reach the chat server. Check your internet connection and try again.");
  }
  const { loginId, pollSecret, userCode } = started.data ?? {};
  if (!started.ok || !LOGIN_ID_RE.test(loginId) || typeof pollSecret !== "string") {
    throw new Error(started.data?.error ?? "The chat server does not support Steam sign-in");
  }

  onCode(typeof userCode === "string" ? userCode : "");
  await openExternal(`${origin}/auth/steam/login?id=${loginId}`);

  const deadline = Date.now() + timeoutMs;
  let failures = 0;
  while (Date.now() < deadline) {
    await sleep(pollMs, signal);
    let polled;
    try {
      polled = await postJson(`${origin}/auth/steam/poll`, { id: loginId, secret: pollSecret }, signal);
    } catch {
      if (signal.aborted) throw new Error("Cancelled");
      if (++failures >= MAX_POLL_FAILURES) throw new Error("Lost contact with the chat server");
      continue;
    }
    failures = 0;
    if (polled.status === 429) continue;
    const data = polled.data ?? {};
    if (data.status === "pending") continue;
    if (data.status === "done" && TOKEN_RE.test(data.token) && data.user?.name) {
      return { token: data.token, user: { provider: "steam", id: String(data.user.id), name: String(data.user.name) } };
    }
    throw new Error(data.status === "failed" ? (data.error ?? "Steam sign-in failed") : "Sign-in expired, try again");
  }
  throw new Error("Timed out waiting for the Steam sign-in");
}

module.exports = { linkWithSteam };
