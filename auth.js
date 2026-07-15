(() => {
  "use strict";

  const KEYS = {
    users: "moaform_users_v1",
    session: "moaform_session_v1",
    participations: "moaform_participations_v1"
  };

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

  function createSalt() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashPassword(password, salt) {
    if (!window.crypto?.subtle) throw new Error("secure-context-required");
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const digest = await window.crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 150000 },
      keyMaterial,
      256
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function getUsers() {
    const users = readJSON(KEYS.users, []);
    return Array.isArray(users) ? users : [];
  }

  function getCurrentUser() {
    const session = readJSON(KEYS.session, null);
    if (!session?.userId) return null;
    return getUsers().find((user) => user.id === session.userId) || null;
  }

  function logout() {
    window.localStorage.removeItem(KEYS.session);
    renderAuthSlots();
    renderAuthPage();
  }

  function getParticipations(userId = getCurrentUser()?.id) {
    if (!userId) return [];
    const records = readJSON(KEYS.participations, []);
    return (Array.isArray(records) ? records : []).filter((item) => item.userId === userId);
  }

  function hasParticipated(surveyId) {
    const user = getCurrentUser();
    return Boolean(user && getParticipations(user.id).some((item) => item.surveyId === String(surveyId)));
  }

  function registerParticipation(surveyId) {
    const user = getCurrentUser();
    if (!user) return { ok: false, reason: "login-required" };
    const savedRecords = readJSON(KEYS.participations, []);
    const records = Array.isArray(savedRecords) ? savedRecords : [];
    if (records.some((item) => item.userId === user.id && item.surveyId === String(surveyId))) {
      return { ok: false, reason: "duplicate" };
    }
    try {
      records.push({ userId: user.id, surveyId: String(surveyId), startedAt: new Date().toISOString() });
      writeJSON(KEYS.participations, records);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: "storage-error" };
    }
  }

  window.MoaAuth = { getCurrentUser, logout, getParticipations, hasParticipated, registerParticipation };

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
          const date = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.startedAt));
          return `<li><strong>${escapeHTML(title)}</strong><span>${escapeHTML(date)} 참여 시작</span></li>`;
        }).join("")
      : '<li class="participation-empty">아직 참여한 설문이 없어요.</li>';
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
    if (getUsers().some((user) => user.id === id)) return setMessage(message, "이미 사용 중인 아이디입니다.");
    if (name.length < 2) return setMessage(message, "추첨 대상자 확인을 위해 이름을 2자 이상 입력해 주세요.");
    if (!/^01[016789]\d{7,8}$/.test(phone)) return setMessage(message, "올바른 휴대전화 번호를 입력해 주세요.");
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) return setMessage(message, "비밀번호는 영문과 숫자를 포함해 8자 이상이어야 합니다.");
    if (password !== passwordConfirm) return setMessage(message, "비밀번호가 서로 일치하지 않습니다.");
    if (!formData.get("privacyConsent")) return setMessage(message, "회원정보 수집 및 이용에 동의해 주세요.");

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const salt = createSalt();
      const passwordHash = await hashPassword(password, salt);
      const users = getUsers();
      users.push({ id, displayId, name, phone, salt, passwordHash, createdAt: new Date().toISOString() });
      writeJSON(KEYS.users, users);
      writeJSON(KEYS.session, { userId: id, loginAt: new Date().toISOString() });
      setMessage(message, "회원가입이 완료됐어요. 설문 페이지로 이동합니다.", "success");
      window.setTimeout(() => { window.location.href = safeNextPath(); }, 650);
    } catch (error) {
      setMessage(message, "이 브라우저에서는 안전한 비밀번호 저장 기능을 사용할 수 없어요.");
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
    const user = getUsers().find((item) => item.id === id);
    if (!user) return setMessage(message, "아이디 또는 비밀번호가 일치하지 않습니다.");

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const passwordHash = await hashPassword(password, user.salt);
      if (passwordHash !== user.passwordHash) {
        submit.disabled = false;
        return setMessage(message, "아이디 또는 비밀번호가 일치하지 않습니다.");
      }
      writeJSON(KEYS.session, { userId: user.id, loginAt: new Date().toISOString() });
      setMessage(message, "로그인됐어요. 설문 페이지로 이동합니다.", "success");
      window.setTimeout(() => { window.location.href = safeNextPath(); }, 450);
    } catch (error) {
      setMessage(message, "로그인 처리 중 문제가 발생했어요. 다시 시도해 주세요.");
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
  const initialMode = new URLSearchParams(window.location.search).get("mode");
  if (document.getElementById("authForms") && !getCurrentUser()) setTab(initialMode);
  document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
  document.getElementById("signupForm")?.addEventListener("submit", handleSignup);
})();
