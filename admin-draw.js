(() => {
  "use strict";

  const COLORS = ["#ff385c", "#ffd1da", "#f7c7d2", "#f2f2f2", "#ff8fa5", "#ebebeb", "#e00b41", "#ffc2ce"];
  const state = { surveys: [], spinning: new Set(), canDraw: false };
  const $ = (id) => document.getElementById(id);
  const elements = {
    loading: $("drawLoading"), denied: $("drawDenied"), empty: $("drawEmpty"), error: $("drawError"),
    errorMessage: $("drawErrorMessage"), heading: $("drawBoardHeading"), grid: $("wheelGrid"), toast: $("drawToast"),
    badge: $("drawRoleBadge"), heroKicker: $("drawHeroKicker"), heroTitle: $("drawHeroTitle"), heroDescription: $("drawHeroDescription"),
    emptyTitle: $("drawEmptyTitle"), emptyDescription: $("drawEmptyDescription"), boardLabel: $("drawBoardLabel"), boardTitle: $("drawBoardTitle"), refresh: $("refreshDrawData")
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

  function winnerSlots(draw, winnerCount) {
    const winners = Array.isArray(draw?.winners) ? draw.winners : draw?.winner ? [draw.winner] : [];
    return Array.from({ length: winnerCount }, (_, index) => {
      const winner = winners[index];
      if (!winner) return `<li class="draw-winner-slot pending"><span>${index + 1}</span><div><small>당첨자 ${index + 1}</small><strong>추첨 전</strong><p>참여자가 충족되면 결과가 표시됩니다.</p></div></li>`;
      const phone = winner.phoneMasked || maskPhone(winner.phone);
      return `<li class="draw-winner-slot complete" style="--winner-delay:${index * 70}ms"><span>${index + 1}</span><div><small>당첨자 ${index + 1}</small><strong>${escapeHTML(winner.name)}</strong><p>${escapeHTML(phone)}</p></div></li>`;
    }).join("");
  }

  function resultMarkup(draw, targetCount) {
    const winnerCount = Math.max(1, Number(draw?.winnerCount || targetCount || 1));
    const details = draw
      ? `<p class="draw-result-meta">${escapeHTML(new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(draw.drawnAt)))} · 추첨 ID ${escapeHTML(draw.id)}</p>`
      : `<p class="draw-result-meta">목표 당첨 인원 ${winnerCount}명</p>`;
    return `<section class="draw-winner-result${draw ? " complete" : " pending"}"><div class="draw-winner-result-head"><div><span>${draw ? "🎉 추첨 완료" : "추첨 대기"}</span><h4>${draw ? `${winnerCount}명 당첨 결과` : `${winnerCount}명 당첨 예정`}</h4></div>${details}</div><ol class="draw-winner-list">${winnerSlots(draw, winnerCount)}</ol></section>`;
  }

  function applyMode() {
    if (state.canDraw) {
      elements.badge.textContent = "qwer 마스터 · 추첨 가능";
      elements.heroKicker.textContent = "MASTER RANDOM DRAW";
      elements.heroTitle.innerHTML = "완료된 설문별로<br />행운의 주인공들을 뽑아보세요.";
      elements.heroDescription.textContent = "경품에 설정된 당첨 인원만큼 서버에서 중복 없이 추첨하고, 확정된 모든 결과를 공개합니다.";
      elements.emptyTitle.textContent = "추첨할 설문 기록이 없습니다.";
      elements.emptyDescription.textContent = "회원의 설문 참여 기록이 저장되면 설문별 당첨자 추첨 화면이 생성됩니다.";
      elements.boardLabel.textContent = "COMPLETED SURVEYS";
      elements.boardTitle.textContent = "설문별 당첨자 추첨";
      elements.refresh.textContent = "참여 기록 새로고침";
      return;
    }
    elements.badge.textContent = "회원 열람 가능";
    elements.heroKicker.textContent = "PRIZE DRAW RESULTS";
    elements.heroTitle.innerHTML = "완료된 설문의<br />당첨 결과를 확인하세요.";
    elements.heroDescription.textContent = "추첨은 qwer 마스터 계정에서만 진행하며, 완료된 결과는 모든 로그인 사용자에게 공개합니다.";
    elements.emptyTitle.textContent = "아직 공개된 추첨 결과가 없습니다.";
    elements.emptyDescription.textContent = "추첨이 완료되면 설문별 당첨 결과가 여기에 공개됩니다.";
    elements.boardLabel.textContent = "DRAW RESULTS";
    elements.boardTitle.textContent = "공개된 당첨 결과";
    elements.refresh.textContent = "결과 새로고침";
  }

  function wheelCard(item) {
    const survey = surveyInfo(item.surveyId);
    const completed = Boolean(item.draw);
    const participants = Array.isArray(item.participants) ? item.participants : [];
    const participantCount = state.canDraw ? participants.length : Number(item.draw?.participantCount || participants.length);
    const winnerCount = Math.max(1, Number(item.winnerCount || item.draw?.winnerCount || 1));
    const enoughParticipants = participantCount >= winnerCount;
    const action = state.canDraw
      ? `<button class="button ${completed || !enoughParticipants ? "button-ghost" : "button-primary"} wheel-spin-button" type="button" data-spin-survey="${escapeHTML(item.surveyId)}" ${completed || !enoughParticipants ? "disabled" : ""}>${completed ? "추첨 완료" : enoughParticipants ? `${winnerCount}명 당첨자 추첨하기` : `참여자 부족 · ${participantCount}/${winnerCount}명`}</button>`
      : '<p class="draw-viewer-note">이 결과는 CASH CHECK 마스터 추첨을 통해 확정되었습니다.</p>';
    return `<article class="wheel-card${state.canDraw ? "" : " viewer-result-card"}" data-wheel-card="${escapeHTML(item.surveyId)}">
      <div class="wheel-card-head"><div><span>${completed ? "추첨 완료" : enoughParticipants ? "추첨 가능" : "참여자 대기"}</span><h3>${escapeHTML(survey.title)}</h3><p>${escapeHTML(survey.reward || "경품")} · 참여자 ${participantCount}명</p></div><b>${winnerCount}명</b></div>
      <div data-wheel-result="${escapeHTML(item.surveyId)}">${resultMarkup(item.draw, winnerCount)}</div>
      ${action}
    </article>`;
  }

  function renderBoard() {
    elements.grid.innerHTML = state.surveys.map(wheelCard).join("");
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
      state.canDraw = payload.canDraw === true;
      applyMode();
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
    if (!state.canDraw || state.spinning.has(surveyId)) return;
    const item = state.surveys.find((survey) => survey.surveyId === surveyId);
    const winnerCount = Math.max(1, Number(item?.winnerCount || 1));
    state.spinning.add(surveyId); button.disabled = true; button.textContent = `${winnerCount}명 당첨자를 선정하는 중…`;
    const result = elements.grid.querySelector(`[data-wheel-result="${CSS.escape(surveyId)}"]`);
    result.innerHTML = `<div class="draw-reveal-loading"><span class="loading-spinner" aria-hidden="true"></span><strong>공정하게 당첨자를 선정하고 있어요.</strong></div>`;
    try {
      const payload = await drawRequest("POST", { surveyId });
      item.participants = payload.participants;
      item.draw = payload.draw;
      button.textContent = "당첨 결과를 공개하는 중…";
      window.setTimeout(() => {
        result.innerHTML = resultMarkup(payload.draw, winnerCount);
        button.className = "button button-ghost wheel-spin-button"; button.textContent = "추첨 완료"; button.disabled = true;
        celebrate(button.closest(".wheel-card")); showToast(`${payload.draw.winners.length}명의 당첨자가 확정됐습니다!`);
        state.spinning.delete(surveyId);
      }, 1400);
    } catch (error) {
      state.spinning.delete(surveyId);
      result.innerHTML = resultMarkup(null, winnerCount);
      const insufficient = error.message === "insufficient-participants";
      button.disabled = insufficient;
      button.textContent = insufficient ? "당첨 인원보다 참여자가 부족합니다" : `${winnerCount}명 당첨자 다시 추첨하기`;
      showToast(error.message === "empty-participant-pool" || insufficient ? "당첨 인원보다 참여자가 부족합니다." : "추첨하지 못했습니다. 다시 시도해 주세요.");
    }
  }

  elements.grid.addEventListener("click", (event) => { const button = event.target.closest("[data-spin-survey]"); if (button) spin(button.dataset.spinSurvey, button); });
  $("retryDrawData").addEventListener("click", loadDrawData); $("refreshDrawData").addEventListener("click", loadDrawData);
  loadDrawData();
})();
