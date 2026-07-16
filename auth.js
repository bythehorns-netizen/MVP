(() => {
  "use strict";

  const SESSION_KEY = "cashcheck_supabase_session_v1";
  const AUTH_EMAIL_DOMAIN = "cashcheck.local";

  let activeSession = readJSON(SESSION_KEY, null);
  let currentUser = activeSession?.user ? normalizeUser(activeSession.user) : null;
  let authReady = Promise.resolve(currentUser);

  function readJSON(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizeId(value) {
    return String(value || "").trim().toLowerCase();
  }

  function idToEmail(id) {
    return `${normalizeId(id)}@${AUTH_EMAIL_DOMAIN}`;
  }

  function emailToDisplayId(email, metadata = {}) {
    return metadata.display_id || metadata.username || String(email || "").split("@")[0] || "member";
  }

  function getConfig() {
    const config = window.CASHCHECK_CONFIG || {};
    return {
      supabaseUrl: String(config.supabaseUrl || "").replace(/\/+$/, ""),
      supabaseAnonKey: String(config.supabaseAnonKey || "")
    };
  }

  function isConfigured() {
    const { supabaseUrl, supabaseAnonKey } = getConfig();
    return Boolean(supabaseUrl && supabaseAnonKey);
  }

  async function authRequest(path, options = {}) {
    const { supabaseUrl, supabaseAnonKey } = getConfig();
    if (!supabaseUrl || !supabaseAnonKey) throw new Error("missing-supabase-config");

    const headers = {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json"
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const response = await fetch(`${supabaseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || "request-failed";
      throw new Error(message);
    }
    return payload;
  }

  function normalizeParticipations(value) {
    return Array.isArray(value)
      ? value
          .filter((item) => item?.surveyId && (item?.completedAt || item?.startedAt))
          .map((item) => ({
            surveyId: String(item.surveyId),
            startedAt: String(item.startedAt || item.completedAt),
            completedAt: String(item.completedAt || item.startedAt)
          }))
      : [];
  }

  function normalizeUser(user) {
    const metadata = user?.user_metadata || {};
    const displayId = emailToDisplayId(user?.email, metadata);
    return {
      id: user?.id || normalizeId(displayId),
      email: user?.email || idToEmail(displayId),
      displayId,
      username: metadata.username || normalizeId(displayId),
      name: metadata.name || displayId,
      phone: metadata.phone || "",
      participations: normalizeParticipations(metadata.participations),
      raw: user
    };
  }

  function saveSession(session) {
    if (!session?.access_token || !session?.user) return null;
    const normalized = {
      ...session,
      expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600)
    };
    activeSession = normalized;
    currentUser = normalizeUser(normalized.user);
    writeJSON(SESSION_KEY, normalized);
    return normalized;
  }

  function clearSession() {
    activeSession = null;
    currentUser = null;
    window.localStorage.removeItem(SESSION_KEY);
  }

  function getCurrentUser() {
    return currentUser;
  }

  function getAccessToken() {
    return activeSession?.access_token || "";
  }

  function isMaster() {
    if (!currentUser) return false;
    return [currentUser.username, currentUser.displayId, currentUser.email?.split("@")[0]]
      .some((value) => normalizeId(value) === "qwer");
  }

  async function refreshSessionIfNeeded() {
    if (!activeSession?.refresh_token) return null;
    const expiresAt = Number(activeSession.expires_at || 0);
    if (expiresAt && expiresAt - Math.floor(Date.now() / 1000) > 90) return activeSession;

    const refreshed = await authRequest("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: activeSession.refresh_token }
    });
    return saveSession(refreshed);
  }

  async function fetchCurrentUser() {
    const session = await refreshSessionIfNeeded();
    if (!session?.access_token) return null;
    const user = await authRequest("/auth/v1/user", { token: session.access_token });
    saveSession({ ...session, user });
    return currentUser;
  }

  function logout() {
    const token = activeSession?.access_token;
    clearSession();
    renderAuthSlots();
    renderAuthPage();
    if (token && isConfigured()) {
      authRequest("/auth/v1/logout", { method: "POST", token }).catch(() => {});
    }
  }

  function getParticipations(userId = currentUser?.id) {
    if (!currentUser || userId !== currentUser.id) return [];
    return [...currentUser.participations];
  }

  function hasParticipated(surveyId) {
    return Boolean(currentUser && currentUser.participations.some((item) => item.surveyId === String(surveyId)));
  }

  async function updateUserMetadata(metadata) {
    const session = await refreshSessionIfNeeded();
    if (!session?.access_token || !activeSession?.user) throw new Error("login-required");
    const nextMetadata = { ...(activeSession.user.user_metadata || {}), ...metadata };
    const response = await authRequest("/auth/v1/user", {
      method: "PUT",
      token: session.access_token,
      body: { data: nextMetadata }
    });
    const user = response?.user || response;
    saveSession({ ...session, user });
    renderAuthSlots();
    renderAuthPage();
  }

  function registerParticipation(surveyId) {
    if (!currentUser) return { ok: false, reason: "login-required" };
    if (hasParticipated(surveyId)) return { ok: false, reason: "duplicate" };

    const completedAt = new Date().toISOString();
    const nextRecords = [...currentUser.participations, { surveyId: String(surveyId), startedAt: completedAt, completedAt }];
    currentUser = { ...currentUser, participations: nextRecords };
    if (activeSession?.user) {
      const nextUser = {
        ...activeSession.user,
        user_metadata: {
          ...(activeSession.user.user_metadata || {}),
          participations: nextRecords
        }
      };
      saveSession({ ...activeSession, user: nextUser });
    }
    updateUserMetadata({ participations: nextRecords }).catch(() => {});
    return { ok: true };
  }

  window.MoaAuth = {
    getCurrentUser,
    getAccessToken,
    isMaster,
    whenReady: () => authReady,
    logout,
    getParticipations,
    hasParticipated,
    registerParticipation
  };

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderSlot(slot, mobile = false) {
    const user = getCurrentUser();
    if (user) {
      slot.innerHTML = `<div class="auth-user-menu"><a class="auth-user-chip" href="./auth.html" aria-label="내 참여 기록 보기">${escapeHTML(user.name)}님</a><button class="auth-logout" type="button" data-auth-logout>로그아웃</button></div>`;
      return;
    }
    slot.innerHTML = `<div class="auth-links"><a class="text-button auth-login-link" href="./auth.html?mode=login">로그인</a><a class="button button-small button-dark auth-signup-link" href="./auth.html?mode=signup">회원가입</a></div>`;
    if (mobile) slot.querySelector(".auth-signup-link")?.classList.add("button-primary");
  }

  function renderAuthSlots() {
    document.querySelectorAll("[data-auth-slot]").forEach((slot) => renderSlot(slot));
    document.querySelectorAll("[data-auth-mobile]").forEach((slot) => renderSlot(slot, true));
    document.querySelectorAll("[data-master-only]").forEach((element) => {
      element.hidden = !isMaster();
    });
  }

  function safeNextPath() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (!next || !/^\.\/[a-zA-Z0-9._/-]+(?:[?#][^\\]*)?$/.test(next) || next.includes("\\")) return "./surveys.html";
    return next;
  }

  function setMessage(element, message, type = "error") {
    if (!element) return;
    element.textContent = message;
    element.className = `auth-message ${message ? type : ""}`.trim();
  }

  function setTab(mode) {
    const safeMode = mode === "signup" ? "signup" : "login";
    document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
      const active = tab.dataset.authTab === safeMode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    const loginPanel = document.getElementById("loginPanel");
    const signupPanel = document.getElementById("signupPanel");
    if (loginPanel) loginPanel.hidden = safeMode !== "login";
    if (signupPanel) signupPanel.hidden = safeMode !== "signup";
    document.getElementById(safeMode === "login" ? "loginId" : "signupId")?.focus();
  }

  function maskPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length < 8) return "등록됨";
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }

  function renderAuthPage() {
    const authForms = document.getElementById("authForms");
    const accountView = document.getElementById("accountView");
    if (!authForms || !accountView) return;
    const user = getCurrentUser();
    authForms.hidden = Boolean(user);
    accountView.hidden = !user;
    if (!user) return;

    const participations = getParticipations(user.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const surveys = window.MOAFORM_SURVEYS || [];
    document.getElementById("accountName").textContent = user.name;
    document.getElementById("accountId").textContent = user.displayId;
    document.getElementById("participationCount").textContent = participations.length;
    document.getElementById("accountTitle").title = `기프티콘 연락처 ${maskPhone(user.phone)}`;
    document.getElementById("participationList").innerHTML = participations.length
      ? participations.map((record) => {
          const survey = surveys.find((item) => String(item.id) === record.surveyId);
          const title = survey?.title || `설문 ${record.surveyId}`;
          const date = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.completedAt || record.startedAt));
          return `<li><strong>${escapeHTML(title)}</strong><span>${escapeHTML(date)} 참여 완료</span></li>`;
        }).join("")
      : '<li class="participation-empty">아직 참여한 설문이 없어요.</li>';
  }

  function authErrorMessage(error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (message.includes("missing-supabase-config")) return "Supabase 연결 설정을 불러오지 못했어요. Vercel 배포 환경에서 다시 시도해 주세요.";
    if (message.includes("already") || message.includes("registered")) return "이미 사용 중인 아이디입니다.";
    if (message.includes("invalid login") || message.includes("invalid credentials")) return "아이디 또는 비밀번호가 일치하지 않습니다.";
    if (message.includes("email not confirmed") || message.includes("confirm")) return "Supabase Auth의 이메일 확인 설정이 켜져 있어요. 아이디 로그인을 쓰려면 이메일 확인을 꺼야 합니다.";
    return "처리 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.";
  }

  async function handleSignup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById("signupMessage");
    const formData = new FormData(form);
    const displayId = String(formData.get("userId") || "").trim();
    const id = normalizeId(displayId);
    const name = String(formData.get("name") || "").trim();
    const phone = String(formData.get("phone") || "").replace(/\D/g, "");
    const password = String(formData.get("password") || "");
    const passwordConfirm = String(formData.get("passwordConfirm") || "");

    if (!/^[a-zA-Z][a-zA-Z0-9_]{3,19}$/.test(displayId)) return setMessage(message, "아이디는 영문으로 시작하는 영문·숫자·밑줄 4~20자로 입력해 주세요.");
    if (name.length < 2) return setMessage(message, "추첨 대상자 확인을 위해 이름을 2자 이상 입력해 주세요.");
    if (!/^01[016789]\d{7,8}$/.test(phone)) return setMessage(message, "올바른 휴대전화 번호를 입력해 주세요.");
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) return setMessage(message, "비밀번호는 영문과 숫자를 포함해 8자 이상이어야 합니다.");
    if (password !== passwordConfirm) return setMessage(message, "비밀번호가 서로 일치하지 않습니다.");
    if (!formData.get("privacyConsent")) return setMessage(message, "회원정보 수집 및 이용에 동의해 주세요.");
    if (!isConfigured()) return setMessage(message, "Supabase 연결 설정을 불러오지 못했어요. Vercel 배포 환경에서 다시 시도해 주세요.");

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const profile = { username: id, display_id: displayId, name, phone, participations: [] };
      const signup = await authRequest("/auth/v1/signup", {
        method: "POST",
        body: { email: idToEmail(id), password, data: profile }
      });
      const session = signup?.session || await authRequest("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email: idToEmail(id), password }
      });
      saveSession(session);
      setMessage(message, "회원가입이 완료됐어요. 설문 페이지로 이동합니다.", "success");
      window.setTimeout(() => { window.location.href = safeNextPath(); }, 650);
    } catch (error) {
      setMessage(message, authErrorMessage(error));
      submit.disabled = false;
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById("loginMessage");
    const formData = new FormData(form);
    const id = normalizeId(formData.get("userId"));
    const password = String(formData.get("password") || "");
    if (!id || !password) return setMessage(message, "아이디와 비밀번호를 모두 입력해 주세요.");
    if (!isConfigured()) return setMessage(message, "Supabase 연결 설정을 불러오지 못했어요. Vercel 배포 환경에서 다시 시도해 주세요.");

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const session = await authRequest("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email: idToEmail(id), password }
      });
      saveSession(session);
      setMessage(message, "로그인됐어요. 설문 페이지로 이동합니다.", "success");
      window.setTimeout(() => { window.location.href = safeNextPath(); }, 450);
    } catch (error) {
      setMessage(message, authErrorMessage(error));
      submit.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const logoutButton = event.target.closest("[data-auth-logout]");
    if (logoutButton) {
      logout();
      return;
    }
    const tab = event.target.closest("[data-auth-tab]");
    if (tab) setTab(tab.dataset.authTab);
    const switchButton = event.target.closest("[data-switch-auth]");
    if (switchButton) setTab(switchButton.dataset.switchAuth);
  });

  renderAuthSlots();
  renderAuthPage();
  authReady = fetchCurrentUser().then(() => {
    renderAuthSlots();
    renderAuthPage();
    document.dispatchEvent(new CustomEvent("cashcheck:authchange"));
    return currentUser;
  }).catch(() => {
    clearSession();
    renderAuthSlots();
    renderAuthPage();
    document.dispatchEvent(new CustomEvent("cashcheck:authchange"));
    return null;
  });

  const initialMode = new URLSearchParams(window.location.search).get("mode");
  if (document.getElementById("authForms") && !getCurrentUser()) setTab(initialMode);
  document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
  document.getElementById("signupForm")?.addEventListener("submit", handleSignup);
})();
