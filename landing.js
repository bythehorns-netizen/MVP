const surveys = window.MOAFORM_SURVEYS || [];
const openingPrizeGrid = document.getElementById("openingPrizeGrid");

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getPrizeTheme(reward) {
  const name = String(reward || "");
  if (name.includes("스타벅스")) return { provider: "STARBUCKS", key: "스타벅스", icon: "☕", color: "#e4f3eb", ink: "#00754a" };
  if (name.includes("메가커피")) return { provider: "MEGA COFFEE", key: "메가커피", icon: "🥤", color: "#fff0b8", ink: "#6c4b00" };
  if (name.includes("BBQ")) return { provider: "BBQ", key: "BBQ", icon: "🍗", color: "#ffe9e2", ink: "#b42227" };
  return { provider: "GIFTICON", key: name.split(" ")[0] || "기타", icon: "🎁", color: "#eef0ff", ink: "#425bea" };
}

function splitReward(reward) {
  const match = String(reward || "").match(/^(.*?)\s*\((\d+명)\)\s*$/);
  return match ? { name: match[1], winners: match[2] } : { name: String(reward || "경품 확인 중"), winners: "당첨 인원 확인" };
}

function getOpeningSurveys() {
  const groups = new Map();
  surveys.forEach((survey) => {
    const key = getPrizeTheme(survey.reward).key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(survey);
  });

  const selected = ["스타벅스", "메가커피", "BBQ"].flatMap((key) => {
    const group = groups.get(key) || [];
    return group.length ? [group[Math.floor(Math.random() * group.length)]] : [];
  });
  const remaining = surveys.filter((survey) => !selected.some((item) => item.id === survey.id));

  while (selected.length < 3 && remaining.length) {
    selected.push(remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0]);
  }
  return selected.slice(0, 3);
}

function renderOpeningPrizes() {
  if (!surveys.length) {
    openingPrizeGrid.innerHTML = '<p class="landing-empty">현재 참여할 수 있는 설문이 없어요.</p>';
    return;
  }

  openingPrizeGrid.innerHTML = getOpeningSurveys().map((survey) => {
    const theme = getPrizeTheme(survey.reward);
    const prize = splitReward(survey.reward);
    const destination = `./surveys.html?survey=${encodeURIComponent(survey.id)}`;
    return `
      <article class="prize-card" style="--prize-color:${theme.color};--prize-ink:${theme.ink}">
        <span class="prize-brand">${escapeHTML(theme.provider)}</span>
        <div class="prize-visual" aria-hidden="true"><span>${theme.icon}</span></div>
        <div class="prize-info">
          <span>추첨 경품</span>
          <h2>${escapeHTML(prize.name)}</h2>
          <strong>${escapeHTML(prize.winners)} 당첨</strong>
          <p>${escapeHTML(survey.title)} · 약 ${Number(survey.duration)}분</p>
        </div>
        <a class="prize-hit" href="${destination}" aria-label="${escapeHTML(prize.name)} 경품 설문으로 이동"></a>
      </article>`;
  }).join("");
}

renderOpeningPrizes();
