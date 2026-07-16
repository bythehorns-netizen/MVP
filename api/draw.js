const { randomInt, randomBytes } = require("crypto");

const MASTER_ID = "qwer";

function config() {
  return {
    url: String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
    anonKey: String(process.env.SUPABASE_ANON_KEY || ""),
    serviceKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "")
  };
}

function json(response, status, payload) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  return response.status(status).json(payload);
}

async function supabaseRequest(path, options = {}) {
  const { url, anonKey, serviceKey } = config();
  const key = options.admin ? serviceKey : anonKey;
  if (!url || !anonKey || !serviceKey) throw new Error("missing-server-config");
  const response = await fetch(`${url}${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${options.token || key}`,
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.msg || payload?.error || "supabase-request-failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function isMaster(user) {
  return String(user?.email || "").trim().toLowerCase() === `${MASTER_ID}@cashcheck.local`;
}

async function verifyUser(request) {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    const error = new Error("login-required"); error.status = 401; throw error;
  }
  const user = await supabaseRequest("/auth/v1/user", { token });
  return user;
}

async function listAllUsers() {
  const users = [];
  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const payload = await supabaseRequest(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`, { admin: true });
    const batch = Array.isArray(payload?.users) ? payload.users : [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }
  return users;
}

function normalizeDraws(value) {
  return Array.isArray(value) ? value.filter((draw) => draw?.surveyId && draw?.winner?.userId) : [];
}

function buildSurveyPools(users, masterUser) {
  const pools = new Map();
  users.forEach((user) => {
    if (!user?.id || user.id === masterUser.id) return;
    const metadata = user.user_metadata || {};
    const participations = Array.isArray(metadata.participations) ? metadata.participations : [];
    const seenSurveys = new Set();
    participations.forEach((record) => {
      const surveyId = String(record?.surveyId || "").trim();
      if (!surveyId || seenSurveys.has(surveyId)) return;
      seenSurveys.add(surveyId);
      if (!pools.has(surveyId)) pools.set(surveyId, []);
      pools.get(surveyId).push({
        userId: user.id,
        name: String(metadata.name || metadata.display_id || "응답자"),
        phone: String(metadata.phone || ""),
        completedAt: String(record.completedAt || record.startedAt || "")
      });
    });
  });
  return pools;
}

function publicParticipant(person) {
  return { userId: person.userId, name: person.name };
}

function publicDraw(draw) {
  return {
    id: draw.id,
    surveyId: draw.surveyId,
    drawnAt: draw.drawnAt,
    participantCount: draw.participantCount,
    winner: { userId: draw.winner.userId, name: draw.winner.name, phone: draw.winner.phone }
  };
}

function maskName(value) {
  const characters = [...String(value || "당첨자").trim()];
  if (characters.length <= 1) return "*";
  if (characters.length === 2) return `${characters[0]}*`;
  return `${characters[0]}${"*".repeat(characters.length - 2)}${characters.at(-1)}`;
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : "연락처 비공개";
}

function viewerDraw(draw) {
  return {
    id: draw.id,
    surveyId: draw.surveyId,
    drawnAt: draw.drawnAt,
    participantCount: draw.participantCount,
    winner: { name: maskName(draw.winner.name), phoneMasked: maskPhone(draw.winner.phone) }
  };
}

async function saveDraw(masterUser, draws) {
  const metadata = { ...(masterUser.user_metadata || {}), prize_draws: draws };
  return supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(masterUser.id)}`, {
    admin: true,
    method: "PUT",
    body: { user_metadata: metadata }
  });
}

module.exports = async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return json(response, 405, { error: "method-not-allowed" });
  try {
    const requester = await verifyUser(request);
    const canDraw = isMaster(requester);
    if (request.method === "POST" && !canDraw) {
      const error = new Error("master-only"); error.status = 403; throw error;
    }
    const users = await listAllUsers();
    const masterUser = users.find(isMaster) || (canDraw ? requester : null);
    if (!masterUser) {
      const error = new Error("master-account-not-found"); error.status = 404; throw error;
    }
    const pools = buildSurveyPools(users, masterUser);
    const draws = normalizeDraws(masterUser.user_metadata?.prize_draws);

    if (request.method === "GET") {
      if (!canDraw) {
        const surveys = draws
          .map((draw) => ({ surveyId: draw.surveyId, draw: viewerDraw(draw) }))
          .sort((a, b) => new Date(b.draw.drawnAt) - new Date(a.draw.drawnAt));
        return json(response, 200, { canDraw: false, surveys });
      }
      const surveys = [...pools.entries()].map(([surveyId, participants]) => ({
        surveyId,
        participants: participants.map(publicParticipant),
        draw: draws.find((draw) => draw.surveyId === surveyId) ? publicDraw(draws.find((draw) => draw.surveyId === surveyId)) : null
      }));
      return json(response, 200, { canDraw: true, surveys });
    }

    const surveyId = String(request.body?.surveyId || "").trim();
    const participants = pools.get(surveyId) || [];
    if (!surveyId || !participants.length) return json(response, 400, { error: "empty-participant-pool" });
    const previous = draws.find((draw) => draw.surveyId === surveyId);
    if (previous) return json(response, 200, { draw: publicDraw(previous), participants: participants.map(publicParticipant), existing: true });

    const winner = participants[randomInt(participants.length)];
    const draw = {
      id: `CC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(6).toString("hex").toUpperCase()}`,
      surveyId,
      drawnAt: new Date().toISOString(),
      participantCount: participants.length,
      winner: { userId: winner.userId, name: winner.name, phone: winner.phone }
    };
    await saveDraw(masterUser, [...draws, draw]);
    return json(response, 200, { draw: publicDraw(draw), participants: participants.map(publicParticipant), existing: false });
  } catch (error) {
    const status = Number(error.status) || (error.message === "missing-server-config" ? 503 : 500);
    return json(response, status, { error: error.message || "draw-request-failed" });
  }
};
