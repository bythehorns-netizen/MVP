const sampleSurveys = window.MOAFORM_SURVEYS || [];
const SURVEYS_PER_PAGE = 6;

let surveys = [...sampleSurveys];
let selectedCategory = "전체";
let visibleSurveyCount = SURVEYS_PER_PAGE;
let toastTimer;

const surveyGrid = document.getElementById("surveyGrid");
const surveyCount = document.getElementById("surveyCount");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const categoryFilters = document.getElementById("categoryFilters");
const resetFilters = document.getElementById("resetFilters");
const loadMoreWrap = document.getElementById("loadMoreWrap");
const loadMoreButton = document.getElementById("loadMoreButton");
const surveyModal = document.getElementById("surveyModal");
const modalContent = document.getElementById("modalContent");
const modalClose = document.getElementById("modalClose");
const toast = document.getElementById("toast");
const featuredDeadline = document.getElementById("featuredDeadline");
const featuredCategory = document.getElementById("featuredCategory");
const featuredTitle = document.getElementById("featuredTitle");
const featuredDuration = document.getElementById("featuredDuration");
const featuredReward = document.getElementById("featuredReward");
const featuredSurveyButton = document.getElementById("featuredSurveyButton");

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatReward(value) {
  return escapeHTML(value || "경품 확인 중");
}

function renderFeaturedSurvey() {
  if (!surveys.length) return;
  const survey = surveys[Math.floor(Math.random() * surveys.length)];
  const dDayMatch = String(survey.deadline).match(/^D-(\d+)$/i);

  featuredDeadline.textContent = dDayMatch ? `마감까지 ${dDayMatch[1]}일` : `마감 ${survey.deadline}`;
  featuredCategory.textContent = survey.category;
  featuredTitle.textContent = survey.title;
  featuredDuration.textContent = `약 ${Number(survey.duration)}분`;
  featuredReward.textContent = survey.reward;
  featuredSurveyButton.dataset.surveyId = survey.id;
  featuredSurveyButton.setAttribute("aria-label", `${survey.title} 추천 설문 자세히 보기`);
}

function getFilteredSurveys() {
  const keyword = searchInput.value.trim().toLocaleLowerCase("ko-KR");
  return surveys.filter((survey) => {
    const categoryMatch = selectedCategory === "전체" || survey.category === selectedCategory;
    const haystack = `${survey.title} ${survey.description} ${survey.category} ${survey.reward}`.toLocaleLowerCase("ko-KR");
    return categoryMatch && (!keyword || haystack.includes(keyword));
  });
}

function createSurveyCard(survey) {
  return `
    <article class="survey-card" style="--card-color:${escapeHTML(survey.color)};--card-ink:${escapeHTML(survey.ink)}">
      <div class="card-top">
        <span class="card-category">${escapeHTML(survey.category)}</span>
        <span class="card-dday">${escapeHTML(survey.deadline)}</span>
      </div>
      <h3>${escapeHTML(survey.title)}</h3>
      <p class="description">${escapeHTML(survey.description)}</p>
      <div class="card-facts">
        <span>◷ 약 ${Number(survey.duration)}분</span>
        <span>◎ 최소 ${Number(survey.slots)}명 모집</span>
      </div>
      <span class="privacy-badge">${escapeHTML(survey.privacy)}만 수집</span>
      <div class="card-bottom">
        <div><span class="reward-label">추첨 경품</span><strong class="reward-value">${formatReward(survey.reward)}</strong></div>
        <div class="slots"><span>남은 시간</span><strong>${escapeHTML(survey.deadline)}</strong></div>
      </div>
      <button class="card-hit" type="button" data-survey-id="${escapeHTML(survey.id)}" aria-label="${escapeHTML(survey.title)} 자세히 보기"></button>
    </article>`;
}

function renderSurveys() {
  const filteredSurveys = getFilteredSurveys();
  const visibleSurveys = filteredSurveys.slice(0, visibleSurveyCount);
  const remainingCount = Math.max(0, filteredSurveys.length - visibleSurveys.length);
  surveyCount.textContent = filteredSurveys.length;
  surveyGrid.innerHTML = visibleSurveys.map(createSurveyCard).join("");
  surveyGrid.hidden = filteredSurveys.length === 0;
  emptyState.hidden = filteredSurveys.length !== 0;
  loadMoreWrap.hidden = remainingCount === 0;
  loadMoreButton.setAttribute("aria-label", `설문 더 보기. ${remainingCount}개 남음`);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function openSurveyModal(id) {
  const survey = surveys.find((item) => item.id === id);
  if (!survey) return;
  const currentUser = window.MoaAuth?.getCurrentUser();
  const alreadyParticipated = currentUser && window.MoaAuth?.hasParticipated(survey.id);
  const participationAction = alreadyParticipated
    ? '<button class="button button-full participation-complete" type="button" disabled>이미 참여한 설문입니다</button>'
    : survey.surveyUrl
      ? `<a class="button button-primary button-full" href="${escapeHTML(survey.surveyUrl)}" target="_blank" rel="noopener noreferrer" data-participate-survey="${escapeHTML(survey.id)}">설문 시작하기 <span aria-hidden="true">↗</span></a>`
      : '<button class="button button-primary button-full" type="button" id="participateButton">안내 확인하고 참여하기</button>';
  modalContent.innerHTML = `
    <p class="modal-kicker">${escapeHTML(survey.category)} · ${escapeHTML(survey.deadline)}</p>
    <h2 id="modalTitle">${escapeHTML(survey.title)}</h2>
    <p class="modal-description">${escapeHTML(survey.description)}</p>
    <div class="modal-facts">
      <div><span>예상 시간</span><strong>약 ${Number(survey.duration)}분</strong></div>
      <div><span>추첨 경품</span><strong>${formatReward(survey.reward)}</strong></div>
      <div><span>남은 시간</span><strong>${escapeHTML(survey.deadline)}</strong></div>
    </div>
    <div class="draw-box">
      <strong>◎ CASH CHECK가 직접 추첨해요</strong>
      <p>설문 종료 후 주최 측이 아닌 CASH CHECK가 추첨을 진행하고 결과를 안내합니다.</p>
    </div>
    <div class="privacy-box">
      <strong>✓ 참여 전 개인정보 안내</strong>
      <p>이 설문은 ${escapeHTML(survey.privacy)} 정보만 요청합니다. 설문 응답과 경품 발송을 위한 연락 정보는 분리하여 관리할 예정입니다.</p>
    </div>
    <p class="modal-description">등록 기관 · ${escapeHTML(survey.researcher)}</p>
    ${participationAction}`;
  surveyModal.hidden = false;
  document.body.classList.add("modal-open");
  modalClose.focus();

  const surveyStartLink = modalContent.querySelector("[data-participate-survey]");
  if (surveyStartLink) {
    surveyStartLink.addEventListener("click", (event) => {
      if (!window.MoaAuth?.getCurrentUser()) {
        event.preventDefault();
        const returnPath = `./surveys.html?survey=${encodeURIComponent(survey.id)}`;
        window.location.href = `./auth.html?mode=login&next=${encodeURIComponent(returnPath)}`;
        return;
      }

      const result = window.MoaAuth.registerParticipation(survey.id);
      if (!result.ok) {
        event.preventDefault();
        showToast(result.reason === "duplicate" ? "이미 참여한 설문입니다." : "참여 기록을 저장하지 못했어요.");
        openSurveyModal(survey.id);
      }
    });
  }

  const participateButton = document.getElementById("participateButton");
  if (participateButton) {
    participateButton.addEventListener("click", () => {
      closeSurveyModal();
      showToast("이 설문은 아직 참여 링크가 등록되지 않았어요.");
    });
  }
}

function closeSurveyModal() {
  surveyModal.hidden = true;
  document.body.classList.remove("modal-open");
}

categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  selectedCategory = button.dataset.category;
  visibleSurveyCount = SURVEYS_PER_PAGE;
  categoryFilters.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
  renderSurveys();
});

searchInput.addEventListener("input", () => {
  visibleSurveyCount = SURVEYS_PER_PAGE;
  renderSurveys();
});
resetFilters.addEventListener("click", () => {
  selectedCategory = "전체";
  searchInput.value = "";
  visibleSurveyCount = SURVEYS_PER_PAGE;
  categoryFilters.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.category === "전체"));
  renderSurveys();
});

loadMoreButton.addEventListener("click", () => {
  const previousCount = visibleSurveyCount;
  visibleSurveyCount += SURVEYS_PER_PAGE;
  renderSurveys();
  const firstNewSurvey = surveyGrid.children[previousCount];
  if (firstNewSurvey) {
    firstNewSurvey.scrollIntoView({ behavior: "smooth", block: "center" });
    firstNewSurvey.querySelector(".card-hit")?.focus({ preventScroll: true });
  }
});

surveyGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-survey-id]");
  if (button) openSurveyModal(button.dataset.surveyId);
});

featuredSurveyButton.addEventListener("click", () => {
  openSurveyModal(featuredSurveyButton.dataset.surveyId);
});

modalClose.addEventListener("click", closeSurveyModal);
surveyModal.addEventListener("click", (event) => {
  if (event.target === surveyModal) closeSurveyModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !surveyModal.hidden) closeSurveyModal();
});

document.querySelectorAll("[data-toast]").forEach((button) => {
  button.addEventListener("click", () => showToast(button.dataset.toast));
});

const menuButton = document.getElementById("menuButton");
const mobileNav = document.getElementById("mobileNav");
menuButton.addEventListener("click", () => {
  const open = mobileNav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
});
mobileNav.addEventListener("click", (event) => {
  if (!event.target.closest("a")) return;
  mobileNav.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
});

function openSurveyFromQuery() {
  const surveyId = new URLSearchParams(window.location.search).get("survey");
  if (!surveyId) return;
  if (!surveys.some((survey) => survey.id === surveyId)) {
    showToast("연결된 설문을 찾을 수 없어요.");
    return;
  }
  openSurveyModal(surveyId);
}

renderFeaturedSurvey();
renderSurveys();
openSurveyFromQuery();
