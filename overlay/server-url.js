const PROD_SERVER_URL = "https://api.web-and-live.com";

function resolveServerUrl({ argv = process.argv, env = process.env } = {}) {
  const raw = argv.find((a) => a.startsWith("--server="))?.slice("--server=".length) || env.ARC_CHAT_SERVER;
  if (!raw) return { url: PROD_SERVER_URL, overridden: false };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid --server / ARC_CHAT_SERVER value: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`--server / ARC_CHAT_SERVER must be an http(s) URL, got: ${raw}`);
  }
  return { url: parsed.origin, overridden: true };
}

module.exports = { PROD_SERVER_URL, resolveServerUrl };
