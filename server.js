const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = "iyaadhaha123@gmail.com";
const SECRET_CODE = "Quizwitmeisgood";
const DB_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DB_DIR, "store.json");

const GAME_MODES = [
  "Classic",
  "Tower Defense",
  "Cafe",
  "Racing",
  "Battle Royale",
  "Factory",
  "Gold Quest",
  "Crypto Hack",
  "Fishing Frenzy"
];

const makeSkins = () => {
  const tiers = ["Common", "Rare", "Epic", "Legendary", "Mythic"];
  const themes = ["Neon", "Galaxy", "Shadow", "Flame", "Frost", "Jungle", "Cyber", "Candy", "Ocean", "Storm"];
  const animals = ["Fox", "Owl", "Tiger", "Panda", "Wolf", "Dragon", "Shark", "Koala", "Falcon", "Rabbit", "Bear", "Turtle", "Lynx", "Mantis", "Rhino"];
  const skins = [];
  let price = 150;
  for (const tier of tiers) {
    for (const theme of themes) {
      for (const animal of animals) {
        skins.push({ id: `${tier}-${theme}-${animal}`.toLowerCase(), name: `${tier} ${theme} ${animal}`, tier, price });
        price += 5;
      }
    }
  }
  return skins.slice(0, 160);
};

const ALL_SKINS = makeSkins();

const starterQuiz = {
  id: "quiz-general-1",
  title: "General Starter Quiz",
  topic: "General Knowledge",
  createdBy: "system",
  questions: [
    { id: "q1", prompt: "What is the capital city of France?", options: ["Paris", "Rome", "Berlin", "Madrid"], answerIndex: 0, explanation: "Paris is the capital and largest city of France." },
    { id: "q2", prompt: "Which planet is known as the Red Planet?", options: ["Venus", "Earth", "Mars", "Jupiter"], answerIndex: 2, explanation: "Mars appears red due to iron oxide on its surface." },
    { id: "q3", prompt: "2^5 equals?", options: ["8", "16", "32", "64"], answerIndex: 2, explanation: "2 multiplied by itself five times equals 32." }
  ]
};

function defaultStore() {
  return {
    users: {},
    quizzes: [starterQuiz],
    rooms: {},
    xpLevels: [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3300, 4200, 5200],
    metadata: { createdAt: new Date().toISOString() }
  };
}

function ensureStore() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(defaultStore(), null, 2));
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
}

function roleForEmail(email) {
  if (email.toLowerCase() === OWNER_EMAIL) return "owner";
  return "student";
}

function publicUser(u) {
  return {
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    coins: u.coins,
    xp: u.xp,
    level: Math.max(1, Math.floor(u.xp / 200) + 1),
    skins: u.skins,
    unlockedSkins: u.unlockedSkins,
    streak: u.streak,
    lastDailyReward: u.lastDailyReward
  };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/api/config", (req, res) => {
  res.json({ ownerEmail: OWNER_EMAIL, modes: GAME_MODES, skinsCount: ALL_SKINS.length });
});

app.get("/api/skins", (req, res) => {
  res.json(ALL_SKINS);
});

app.post("/api/auth/register", (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !displayName) return res.status(400).json({ error: "email, password, displayName required" });

  const store = readStore();
  const key = email.toLowerCase();
  if (store.users[key]) return res.status(400).json({ error: "User already exists" });

  store.users[key] = {
    email: key,
    password,
    displayName,
    role: roleForEmail(key),
    coins: 500,
    xp: 0,
    skins: ["default-starter"],
    unlockedSkins: [{ id: "default-starter", name: "Default Starter", tier: "Common" }],
    streak: 0,
    lastDailyReward: null,
    banned: false,
    gameStats: { played: 0, wins: 0 }
  };

  writeStore(store);
  res.json({ user: publicUser(store.users[key]), token: key });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const key = (email || "").toLowerCase();
  const store = readStore();
  const user = store.users[key];
  if (!user || user.password !== password) return res.status(401).json({ error: "Invalid credentials" });
  if (user.banned) return res.status(403).json({ error: "Account is banned" });
  user.role = key === OWNER_EMAIL ? "owner" : user.role;
  writeStore(store);
  res.json({ user: publicUser(user), token: key });
});

app.get("/api/me", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "").toLowerCase();
  const store = readStore();
  const user = store.users[token];
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ user: publicUser(user) });
});

app.post("/api/rewards/daily", (req, res) => {
  const { token } = req.body || {};
  const key = (token || "").toLowerCase();
  const store = readStore();
  const user = store.users[key];
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const today = new Date().toISOString().slice(0, 10);
  if (user.lastDailyReward === today) return res.status(400).json({ error: "Daily reward already claimed" });

  user.lastDailyReward = today;
  user.streak += 1;
  const reward = 120 + Math.min(400, user.streak * 10);
  user.coins += reward;
  writeStore(store);

  res.json({ reward, user: publicUser(user) });
});

app.post("/api/rewards/secret", (req, res) => {
  const { token, code } = req.body || {};
  const key = (token || "").toLowerCase();
  const store = readStore();
  const user = store.users[key];
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (code !== SECRET_CODE) return res.status(400).json({ error: "Invalid secret code" });

  if (user.secretCodeClaimed) return res.status(400).json({ error: "Secret code already redeemed" });
  user.secretCodeClaimed = true;
  user.coins += 1000;
  writeStore(store);

  res.json({ coinsAwarded: 1000, user: publicUser(user) });
});

app.get("/api/quizzes", (req, res) => {
  const store = readStore();
  res.json(store.quizzes.map((q) => ({ id: q.id, title: q.title, topic: q.topic, questions: q.questions.length, createdBy: q.createdBy })));
});

app.post("/api/quizzes", (req, res) => {
  const { token, title, topic, questions } = req.body || {};
  const key = (token || "").toLowerCase();
  const store = readStore();
  const user = store.users[key];
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!["teacher", "owner", "moderator"].includes(user.role)) return res.status(403).json({ error: "Only teachers/moderators/owner can create quizzes" });
  if (!title || !topic || !Array.isArray(questions) || questions.length < 1) return res.status(400).json({ error: "Invalid quiz payload" });

  const quiz = {
    id: `quiz-${Date.now()}`,
    title,
    topic,
    createdBy: user.displayName,
    questions: questions.map((q, i) => ({
      id: `q${i + 1}`,
      prompt: q.prompt,
      options: q.options,
      answerIndex: Number(q.answerIndex) || 0,
      explanation: q.explanation || ""
    }))
  };

  store.quizzes.push(quiz);
  writeStore(store);
  res.json({ ok: true, quizId: quiz.id });
});

app.post("/api/tutor/explain", (req, res) => {
  const { question, options, correctIndex } = req.body || {};
  const correct = Array.isArray(options) ? options[Number(correctIndex) || 0] : "the correct option";
  const response = `Let's break it down:\n- Focus on key terms in the question.\n- Eliminate choices that conflict with known facts.\n- The best answer is \"${correct}\" because it matches the core concept.\nTip: Try explaining this in your own words to lock in the idea.`;
  res.json({ explanation: response, source: "quizwitme-ai-tutor" });
});

app.post("/api/moderation/action", (req, res) => {
  const { token, targetEmail, action, role } = req.body || {};
  const store = readStore();
  const actor = store.users[(token || "").toLowerCase()];
  const target = store.users[(targetEmail || "").toLowerCase()];

  if (!actor || !target) return res.status(404).json({ error: "User not found" });
  if (!["moderator", "owner"].includes(actor.role)) return res.status(403).json({ error: "Moderator or owner access required" });

  if (action === "ban") target.banned = true;
  if (action === "unban") target.banned = false;
  if (action === "setRole" && actor.role === "owner") target.role = role;

  writeStore(store);
  res.json({ ok: true, target: publicUser(target) });
});

const liveRooms = new Map();

function roomState(roomCode) {
  if (!liveRooms.has(roomCode)) {
    liveRooms.set(roomCode, {
      code: roomCode,
      players: {},
      hostToken: null,
      mode: "Classic",
      quizId: starterQuiz.id,
      answersThisQuestion: {},
      questionStart: Date.now(),
      antiCheatFlags: []
    });
  }
  return liveRooms.get(roomCode);
}

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomCode, token, displayName, mode }) => {
    const code = String(roomCode || "").toUpperCase().slice(0, 8);
    if (!code) return;

    const room = roomState(code);
    socket.join(code);

    if (!room.hostToken) room.hostToken = token;
    room.mode = GAME_MODES.includes(mode) ? mode : room.mode;
    room.players[token] = {
      token,
      displayName,
      score: room.players[token]?.score || 0,
      xpGained: room.players[token]?.xpGained || 0,
      joinedAt: Date.now(),
      socketId: socket.id
    };

    io.to(code).emit("room:update", {
      code,
      mode: room.mode,
      leaderboard: Object.values(room.players).sort((a, b) => b.score - a.score),
      antiCheatFlags: room.antiCheatFlags.slice(-5)
    });
  });

  socket.on("room:answer", ({ roomCode, token, isCorrect, elapsedMs }) => {
    const room = liveRooms.get(String(roomCode || "").toUpperCase());
    if (!room || !room.players[token]) return;

    const player = room.players[token];
    if (room.answersThisQuestion[token]) {
      room.antiCheatFlags.push(`${player.displayName}: duplicate answer blocked`);
      return;
    }

    if (Number(elapsedMs) < 300) {
      room.antiCheatFlags.push(`${player.displayName}: impossible reaction time detected`);
      return;
    }

    room.answersThisQuestion[token] = true;
    if (isCorrect) {
      player.score += 100;
      player.xpGained += 20;
    } else {
      player.score = Math.max(0, player.score - 20);
    }

    io.to(room.code).emit("room:update", {
      code: room.code,
      mode: room.mode,
      leaderboard: Object.values(room.players).sort((a, b) => b.score - a.score),
      antiCheatFlags: room.antiCheatFlags.slice(-5)
    });
  });

  socket.on("room:nextQuestion", ({ roomCode }) => {
    const room = liveRooms.get(String(roomCode || "").toUpperCase());
    if (!room) return;
    room.answersThisQuestion = {};
    room.questionStart = Date.now();
    io.to(room.code).emit("room:questionReset", { at: room.questionStart });
  });

  socket.on("disconnect", () => {
    for (const [code, room] of liveRooms) {
      const removed = Object.keys(room.players).find((k) => room.players[k].socketId === socket.id);
      if (removed) {
        delete room.players[removed];
        io.to(code).emit("room:update", {
          code,
          mode: room.mode,
          leaderboard: Object.values(room.players).sort((a, b) => b.score - a.score),
          antiCheatFlags: room.antiCheatFlags.slice(-5)
        });
      }
    }
  });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

server.listen(PORT, () => {
  ensureStore();
  console.log(`Quizwitme server running at http://localhost:${PORT}`);
});
