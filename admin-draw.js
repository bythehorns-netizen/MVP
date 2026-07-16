(() => {
  "use strict";

  const COLORS = ["#c8ff47", "#6ee7d8", "#ffd66e", "#ff8f79", "#9eb5ff", "#d5a7ff", "#86dc8c", "#ffb9d2"];
  const state = { surveys: [], spinning: new Set() };
  const $ = (id) => document.getElementById(id);
  const elements = {
    loading: $("drawLoading"), denied: $("drawDenied"), empty: $("drawEmpty"), error: $("drawError"),
    errorMessage: $("drawErrorMessage"), heading: $("drawBoardHeading"), grid: $("wheelGrid"), toast: $("drawToast")
  };
  let toastTimer;

  function escapeHTML(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function surveyInfo(id) {
    return (window.MOAFORM_SURVEYS || []).find((survey) => String(survey.id) === String(id)) || { id, title: `설문 ${id}`, reward: "경품" };
  }

  function maskPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 8 ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : "연락처 등록됨";
  }

  function setView(name) {
    ["loading", "denied", "empty", "error"].forEach((key) => { elements[key].hidden = key !== name; });
    const showBoard = name === "board";
    elements.heading.hidden = !showBoard;
    elements.grid.hidden = !showBoard;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 3000);
  }

  async function drawRequest(method = "GET", body) {
    const token = window.MoaAuth?.getAccessToken();
    const response = await fetch("/api/draw", {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "request-failed");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function drawWheel(canvas, participants) {
    const size = 440;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    canvas.style.width = "100%";
    canvas.style.maxWidth = `${size}px`;
    canvas.style.height = "auto";
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    const center = size / 2;
    const radius = center - 8;
    const count = participants.length;
    const slice = (Math.PI * 2) / count;

    participants.forEach((person, index) => {
      const start = -Math.PI / 2 + index * slice;
      context.beginPath(); context.moveTo(center, center); context.arc(center, center, radius, start, start + slice); context.closePath();
      context.fillStyle = COLORS[index % COLORS.length]; context.fill();
      context.strokeStyle = "rgba(20,20,20,.28)"; context.lineWidth = 2; context.stroke();
      context.save(); context.translate(center, center); context.rotate(start + slice / 2);
      context.textAlign = "right"; context.textBaseline = "middle"; context.fillStyle = "#171717";
      context.font = `700 ${count > 16 ? 11 : count > 10 ? 13 : 16}px "Noto Sans KR"`;
      const label = person.name.length > 8 ? `${person.name.slice(0, 7)}…` : person.name;
      context.fillText(label, radius - 24, 0, Math.max(48, radius * .55)); context.restore();
    });
    context.beginPath(); context.arc(center, center, 24, 0, Math.PI * 2); context.fillStyle = "#171717"; context.fill();
    context.beginPath(); context.arc(center, center, 8, 0, Math.PI * 2); context.fillStyle = "#c8ff47"; context.fill();
  }

  function resultMarkup(draw) {
    if (!draw) return '<div class="wheel-result pending"><span>추첨 전</span><p>버튼을 누르면 서버에서 당첨자가 확정됩니다.</p></div>';
    const time = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(draw.drawnAt));
    return `<div class="wheel-result complete"><span>🎉 당첨자</span><strong>${escapeHTML(draw.winner.name)}</strong><p>${escapeHTML(maskPhone(draw.winner.phone))} · ${escapeHTML(time)}</p><small>추첨 ID ${escapeHTML(draw.id)}</small></div>`;
  }

  function wheelCard(item) {
    const survey = surveyInfo(item.surveyId);
    const completed = Boolean(item.draw);
    return `<article class="wheel-card" data-wheel-card="${escapeHTML(item.surveyId)}">
      <div class="wheel-card-head"><div><span>${completed ? "추첨 완료" : "추첨 대기"}</span><h3>${escapeHTML(survey.title)}</h3><p>${escapeHTML(survey.reward || "경품")} · 참여자 ${item.participants.length}명</p></div><b>${item.participants.length}</b></div>
      <div class="wheel-stage"><div class="wheel-pointer" aria-hidden="true"></div><canvas class="prize-wheel" data-wheel-canvas="${escapeHTML(item.surveyId)}" aria-label="${escapeHTML(survey.title)} 참여자 돌림판"></canvas></div>
      <div data-wheel-result="${escapeHTML(item.surveyId)}">${resultMarkup(item.draw)}</div>
      <button class="button ${completed ? "button-ghost" : "button-primary"} wheel-spin-button" type="button" data-spin-survey="${escapeHTML(item.surveyId)}" ${completed ? "disabled" : ""}>${completed ? "추첨 완료" : "돌림판 돌리기"}</button>
    </article>`;
  }

  function renderBoard() {
    elements.grid.innerHTML = state.surveys.map(wheelCard).join("");
    state.surveys.forEach((item) => drawWheel(elements.grid.querySelector(`[data-wheel-canvas="${CSS.escape(item.surveyId)}"]`), item.participants));
  }

  async function loadDrawData() {
    setView("loading");
    try {
      await window.MoaAuth?.whenReady();
      const user = window.MoaAuth?.getCurrentUser();
      if (!user) {
        window.location.replace(`./auth.html?mode=login&next=${encodeURIComponent("./admin-draw.html")}`);
        return;
      }
      const payload = await drawRequest();
      state.surveys = Array.isArray(payload.surveys) ? payload.surveys : [];
      if (!state.surveys.length) { setView("empty"); return; }
      renderBoard(); setView("board");
    } catch (error) {
      if (error.status === 401 || error.status === 403) { setView("denied"); return; }
      elements.errorMessage.textContent = error.message === "missing-server-config"
        ? "Vercel에 SUPABASE_SERVICE_ROLE_KEY 환경변수를 등록해 주세요."
        : "Supabase 연결 상태를 확인한 뒤 다시 시도해 주세요.";
      setView("error");
    }
  }

  function celebrate(card) {
    for (let i = 0; i < 24; i += 1) {
      const piece = document.createElement("i");
      piece.className = "confetti-piece"; piece.style.setProperty("--x", `${Math.random() * 100}%`); piece.style.setProperty("--drift", `${Math.round(Math.random() * 180 - 90)}px`); piece.style.setProperty("--delay", `${Math.random() * .4}s`); piece.style.setProperty("--color", COLORS[i % COLORS.length]);
      card.append(piece); window.setTimeout(() => piece.remove(), 2600);
    }
  }

  async function spin(surveyId, button) {
    if (state.spinning.has(surveyId)) return;
    state.spinning.add(surveyId); button.disabled = true; button.textContent = "당첨자를 확인하는 중…";
    try {
      const payload = await drawRequest("POST", { surveyId });
      const item = state.surveys.find((survey) => survey.surveyId === surveyId);
      item.participants = payload.participants;
      const winnerIndex = item.participants.findIndex((person) => person.userId === payload.draw.winner.userId);
      const canvas = elements.grid.querySelector(`[data-wheel-canvas="${CSS.escape(surveyId)}"]`);
      drawWheel(canvas, item.participants);
      const slice = 360 / item.participants.length;
      const rotation = 360 * 7 - (winnerIndex * slice + slice / 2);
      canvas.style.transition = "none"; canvas.style.transform = "rotate(0deg)"; void canvas.offsetWidth;
      canvas.style.transition = "transform 5.4s cubic-bezier(.12,.72,.08,1)"; canvas.style.transform = `rotate(${rotation}deg)`;
      button.textContent = "돌림판이 돌아가는 중…";
      window.setTimeout(() => {
        item.draw = payload.draw;
        const result = elements.grid.querySelector(`[data-wheel-result="${CSS.escape(surveyId)}"]`);
        result.innerHTML = resultMarkup(payload.draw);
        button.className = "button button-ghost wheel-spin-button"; button.textContent = "추첨 완료"; button.disabled = true;
        celebrate(button.closest(".wheel-card")); showToast(`${payload.draw.winner.name}님이 당첨됐습니다!`);
        state.spinning.delete(surveyId);
      }, 5500);
    } catch (error) {
      state.spinning.delete(surveyId); button.disabled = false; button.textContent = "돌림판 다시 돌리기";
      showToast(error.message === "empty-participant-pool" ? "추첨할 참여자가 없습니다." : "추첨하지 못했습니다. 다시 시도해 주세요.");
    }
  }

  elements.grid.addEventListener("click", (event) => { const button = event.target.closest("[data-spin-survey]"); if (button) spin(button.dataset.spinSurvey, button); });
  $("retryDrawData").addEventListener("click", loadDrawData); $("refreshDrawData").addEventListener("click", loadDrawData);
  loadDrawData();
})();
