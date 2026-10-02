/*
|--------------------------------------------------------------------------
| Auth
|--------------------------------------------------------------------------
|
| Password hashing (node:crypto scrypt) and in-memory cookie sessions.
| Cookie name: lan_session — HttpOnly, SameSite=Lax.
|
*/

const crypto = require("crypto");

const SESSION_COOKIE = "lan_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SCRYPT_KEYLEN = 32;

const sessions = new Map(); // token → { userId, username, role, expiresAt }

/* ------------------------------------------------------------------ */
/* Password hashing                                                    */
/* ------------------------------------------------------------------ */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, saltHex, hashHex] = String(stored).split("$");

    if (algo !== "scrypt" || !saltHex || !hashHex) {
      return false;
    }

    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(String(password), salt, expected.length);

    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  return token;
}

function destroySession(token) {
  if (token) {
    sessions.delete(token);
  }
}

function getSession(token) {
  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */

function parseCookies(req) {
  const header = req.headers.cookie;

  if (!header) {
    return {};
  }

  const out = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }

  return out;
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000,
  )}`;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function getTokenFromReq(req) {
  return parseCookies(req)[SESSION_COOKIE] || null;
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getSession,
  parseCookies,
  sessionCookie,
  clearCookie,
  getTokenFromReq,
};
