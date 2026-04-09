const socket = io();
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
const ownerEmail = "iyaadhaha123@gmail.com";
let token = localStorage.getItem("quizwitmeToken") || "";
let user = null;
let currentRoom = "";
let answerStart = Date.now();

const byId = (id) => document.getElementById(id);
const authMsg = byId("authMsg");
const teacherMsg = byId("teacherMsg");
const modMsg = byId("modMsg");
const ownerMsg = byId("ownerMsg");

async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showTab(id) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === id));
  panels.forEach((p) => p.classList.toggle("active", p.id === id));
}

tabs.forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

function updateHud() {
  byId("hudRole").textContent = `Role: ${user?.role || "Guest"}`;
  byId("hudCoins").textContent = `Coins: ${user?.coins || 0}`;
  byId("hudXp").textContent = `XP: ${user?.xp || 0}`;
}

function enforceRoleUi() {
  const role = user?.role || "guest";
  if (role !== "owner") document.querySelector('[data-tab="owner"]').style.display = "none";
  if (!["teacher", "owner", "moderator"].includes(role)) document.querySelector('[data-tab="teacher"]').style.display = "none";
  if (!["moderator", "owner"].includes(role)) document.querySelector('[data-tab="moderator"]').style.display = "none";
}

async function refreshMe() {
  if (!token) return;
  const data = await api("/api/me");
  user = data.user;
  updateHud();
  enforceRoleUi();
}

async function loadConfig() {
  const [config, skins, quizzes] = await Promise.all([api("/api/config"), api("/api/skins"), api("/api/quizzes")]);
  byId("modeSelect").innerHTML = config.modes.map((m) => `<option>${m}</option>`).join("");
  byId("skinsGrid").innerHTML = skins.slice(0, 160).map((s) => `<div class="entry"><b>${s.name}</b><br>${s.tier}<br>${s.price} coins</div>`).join("");
  byId("quizzes").innerHTML = quizzes.map((q) => `<div class="entry"><b>${q.title}</b> (${q.topic}) - ${q.questions} questions</div>`).join("");
}

byId("registerBtn").addEventListener("click", async () => {
  try {
    const payload = {
      displayName: byId("regName").value.trim(),
      email: byId("regEmail").value.trim(),
      password: byId("regPass").value.trim()
    };
    const data = await api("/api/auth/register", "POST", payload);
    token = data.token;
    localStorage.setItem("quizwitmeToken", token);
    user = data.user;
    authMsg.textContent = "Registered and logged in.";
    updateHud();
    enforceRoleUi();
  } catch (e) {
    authMsg.textContent = e.message;
  }
});

byId("loginBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/auth/login", "POST", { email: byId("loginEmail").value.trim(), password: byId("loginPass").value.trim() });
    token = data.token;
    localStorage.setItem("quizwitmeToken", token);
    user = data.user;
    authMsg.textContent = "Logged in successfully.";
    updateHud();
    enforceRoleUi();
    if (user.email === ownerEmail) authMsg.textContent = "Owner account detected. Owner panel unlocked.";
  } catch (e) {
    authMsg.textContent = e.message;
  }
});

byId("dailyBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/rewards/daily", "POST", {});
    user = data.user;
    authMsg.textContent = `Daily reward claimed: +${data.reward} coins`;
    updateHud();
  } catch (e) {
    authMsg.textContent = e.message;
  }
});

byId("secretBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/rewards/secret", "POST", { code: byId("secretCode").value.trim() });
    user = data.user;
    authMsg.textContent = `Secret code accepted: +${data.coinsAwarded} coins`;
    updateHud();
  } catch (e) {
    authMsg.textContent = e.message;
  }
});

byId("createQuizBtn").addEventListener("click", async () => {
  try {
    const q = JSON.parse(byId("quizQuestion").value.trim());
    const payload = {
      title: byId("quizTitle").value.trim(),
      topic: byId("quizTopic").value.trim(),
      questions: [q]
    };
    await api("/api/quizzes", "POST", payload);
    teacherMsg.textContent = "Quiz created.";
    await loadConfig();
  } catch (e) {
    teacherMsg.textContent = e.message;
  }
});

byId("banBtn").addEventListener("click", async () => {
  try {
    await api("/api/moderation/action", "POST", { targetEmail: byId("modTarget").value.trim(), action: "ban" });
    modMsg.textContent = "User banned.";
  } catch (e) {
    modMsg.textContent = e.message;
  }
});

byId("unbanBtn").addEventListener("click", async () => {
  try {
    await api("/api/moderation/action", "POST", { targetEmail: byId("modTarget").value.trim(), action: "unban" });
    modMsg.textContent = "User unbanned.";
  } catch (e) {
    modMsg.textContent = e.message;
  }
});

byId("setRoleBtn").addEventListener("click", async () => {
  try {
    await api("/api/moderation/action", "POST", {
      targetEmail: byId("ownerTarget").value.trim(),
      action: "setRole",
      role: byId("ownerRole").value
    });
    ownerMsg.textContent = "Role updated.";
  } catch (e) {
    ownerMsg.textContent = e.message;
  }
});

byId("joinRoomBtn").addEventListener("click", () => {
  if (!user) return (authMsg.textContent = "Login first.");
  currentRoom = byId("roomCode").value.trim().toUpperCase();
  if (!currentRoom) return;
  answerStart = Date.now();
  socket.emit("room:join", {
    roomCode: currentRoom,
    token,
    displayName: user.displayName,
    mode: byId("modeSelect").value
  });
});

byId("correctBtn").addEventListener("click", () => {
  if (!currentRoom || !user) return;
  socket.emit("room:answer", { roomCode: currentRoom, token, isCorrect: true, elapsedMs: Date.now() - answerStart });
});
byId("wrongBtn").addEventListener("click", () => {
  if (!currentRoom || !user) return;
  socket.emit("room:answer", { roomCode: currentRoom, token, isCorrect: false, elapsedMs: Date.now() - answerStart });
});
byId("nextQuestionBtn").addEventListener("click", () => {
  if (!currentRoom) return;
  answerStart = Date.now();
  socket.emit("room:nextQuestion", { roomCode: currentRoom });
});

socket.on("room:update", (state) => {
  byId("leaderboard").innerHTML = state.leaderboard.map((p, i) => `<div class="entry">#${i + 1} ${p.displayName} - ${p.score}</div>`).join("");
  byId("antiCheat").innerHTML = (state.antiCheatFlags || []).map((f) => `<div class="entry">${f}</div>`).join("");
});

socket.on("room:questionReset", () => {
  answerStart = Date.now();
});

byId("tutorBtn").addEventListener("click", async () => {
  try {
    const options = byId("tutorOptions").value.split(",").map((x) => x.trim());
    const correctIndex = Number(byId("tutorCorrect").value || 0);
    const data = await api("/api/tutor/explain", "POST", { question: byId("tutorQuestion").value, options, correctIndex });
    byId("tutorOutput").textContent = data.explanation;
  } catch (e) {
    byId("tutorOutput").textContent = e.message;
  }
});

(async function boot() {
  await loadConfig();
  if (token) {
    try {
      await refreshMe();
    } catch {
      token = "";
      localStorage.removeItem("quizwitmeToken");
    }
  }
})();
