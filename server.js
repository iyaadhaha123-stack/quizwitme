const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = "iyaadhaha123@gmail.com";
const SECRET_CODE = "Quizwitmeisgood";
const JWT_SECRET = process.env.JWT_SECRET || "quizwitme-dev-secret-change-me";
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

function roleForEmail(email) {
  return email.toLowerCase() === OWNER_EMAIL ? "owner" : "student";
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

function ensureJsonStore() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(defaultStore(), null, 2));
}

function readJsonStore() {
  ensureJsonStore();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeJsonStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
}

function generateToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: "7d" });
}

function getAuthEmail(req) {
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer) {
    try {
      const payload = jwt.verify(bearer, JWT_SECRET);
      return (payload.email || "").toLowerCase();
    } catch {
      return null;
    }
  }

  // Backward compatibility for older clients still sending plain token in body.
  const fallback = (req.body?.token || "").toLowerCase();
  if (fallback.includes("@")) return fallback;
  return null;
}

function createJsonDbAdapter() {
  return {
    async init() {
      ensureJsonStore();
    },
    async getUserByEmail(email) {
      const store = readJsonStore();
      return store.users[email] || null;
    },
    async createUser(user) {
      const store = readJsonStore();
      store.users[user.email] = user;
      writeJsonStore(store);
      return user;
    },
    async updateUser(email, updates) {
      const store = readJsonStore();
      if (!store.users[email]) return null;
      store.users[email] = { ...store.users[email], ...updates };
      writeJsonStore(store);
      return store.users[email];
    },
    async listQuizzes() {
      const store = readJsonStore();
      return store.quizzes;
    },
    async createQuiz(quiz) {
      const store = readJsonStore();
      store.quizzes.push(quiz);
      writeJsonStore(store);
      return quiz;
    }
  };
}

function createPostgresDbAdapter(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
  });

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL,
          coins INTEGER NOT NULL DEFAULT 500,
          xp INTEGER NOT NULL DEFAULT 0,
          skins JSONB NOT NULL DEFAULT '[]'::jsonb,
          unlocked_skins JSONB NOT NULL DEFAULT '[]'::jsonb,
          streak INTEGER NOT NULL DEFAULT 0,
          last_daily_reward TEXT,
          banned BOOLEAN NOT NULL DEFAULT FALSE,
          secret_code_claimed BOOLEAN NOT NULL DEFAULT FALSE
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS quizzes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          topic TEXT NOT NULL,
          created_by TEXT NOT NULL,
          questions JSONB NOT NULL
        );
      `);

      const seed = await pool.query("SELECT 1 FROM quizzes WHERE id = $1", [starterQuiz.id]);
      if (seed.rowCount === 0) {
        await pool.query(
          "INSERT INTO quizzes (id, title, topic, created_by, questions) VALUES ($1, $2, $3, $4, $5::jsonb)",
          [starterQuiz.id, starterQuiz.title, starterQuiz.topic, starterQuiz.createdBy, JSON.stringify(starterQuiz.questions)]
        );
      }
    },
    async getUserByEmail(email) {
      const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      if (result.rowCount === 0) return null;
      const u = result.rows[0];
      return {
        email: u.email,
        passwordHash: u.password_hash,
        displayName: u.display_name,
        role: u.role,
        coins: u.coins,
        xp: u.xp,
        skins: u.skins,
        unlockedSkins: u.unlocked_skins,
        streak: u.streak,
        lastDailyReward: u.last_daily_reward,
        banned: u.banned,
        secretCodeClaimed: u.secret_code_claimed
      };
    },
    async createUser(user) {
      await pool.query(
        `INSERT INTO users
          (email, password_hash, display_name, role, coins, xp, skins, unlocked_skins, streak, last_daily_reward, banned, secret_code_claimed)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
        [
          user.email,
          user.passwordHash,
          user.displayName,
          user.role,
          user.coins,
          user.xp,
          JSON.stringify(user.skins),
          JSON.stringify(user.unlockedSkins),
          user.streak,
          user.lastDailyReward,
          user.banned,
          user.secretCodeClaimed
        ]
      );
      return user;
    },
    async updateUser(email, updates) {
      const current = await this.getUserByEmail(email);
      if (!current) return null;
      const merged = { ...current, ...updates };
      await pool.query(
        `UPDATE users SET
          password_hash = $2,
          display_name = $3,
          role = $4,
          coins = $5,
          xp = $6,
          skins = $7::jsonb,
          unlocked_skins = $8::jsonb,
          streak = $9,
          last_daily_reward = $10,
          banned = $11,
          secret_code_claimed = $12
         WHERE email = $1`,
        [
          email,
          merged.passwordHash,
          merged.displayName,
          merged.role,
          merged.coins,
          merged.xp,
          JSON.stringify(merged.skins),
          JSON.stringify(merged.unlockedSkins),
          merged.streak,
          merged.lastDailyReward,
          merged.banned,
          merged.secretCodeClaimed
        ]
      );
      return merged;
    },
    async listQuizzes() {
      const result = await pool.query("SELECT * FROM quizzes ORDER BY id");
      return result.rows.map((q) => ({
        id: q.id,
        title: q.title,
        topic: q.topic,
        createdBy: q.created_by,
        questions: q.questions
      }));
    },
    async createQuiz(quiz) {
      await pool.query(
        "INSERT INTO quizzes (id, title, topic, created_by, questions) VALUES ($1, $2, $3, $4, $5::jsonb)",
        [quiz.id, quiz.title, quiz.topic, quiz.createdBy, JSON.stringify(quiz.questions)]
      );
      return quiz;
    }
  };
}

const db = process.env.DATABASE_URL
  ? createPostgresDbAdapter(process.env.DATABASE_URL)
  : createJsonDbAdapter();

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

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password || !displayName) return res.status(400).json({ error: "email, password, displayName required" });

    const key = email.toLowerCase();
    if (await db.getUserByEmail(key)) return res.status(400).json({ error: "User already exists" });

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = {
      email: key,
      passwordHash,
      displayName,
      role: roleForEmail(key),
      coins: 500,
      xp: 0,
      skins: ["default-starter"],
      unlockedSkins: [{ id: "default-starter", name: "Default Starter", tier: "Common" }],
      streak: 0,
      lastDailyReward: null,
      banned: false,
      secretCodeClaimed: false
    };

    await db.createUser(newUser);
    res.json({ user: publicUser(newUser), token: generateToken(newUser.email) });
  } catch (error) {
    res.status(500).json({ error: "Failed to register" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const key = (email || "").toLowerCase();
    const user = await db.getUserByEmail(key);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    // Opportunistic migration from legacy plain passwords in JSON fallback.
    if (user.password && !user.passwordHash) {
      user.passwordHash = await bcrypt.hash(user.password, 12);
      delete user.password;
      await db.updateUser(key, user);
    }

    const valid = await bcrypt.compare(password || "", user.passwordHash || "");
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    if (user.banned) return res.status(403).json({ error: "Account is banned" });

    user.role = key === OWNER_EMAIL ? "owner" : user.role;
    await db.updateUser(key, { role: user.role });
    res.json({ user: publicUser(user), token: generateToken(user.email) });
  } catch (error) {
    res.status(500).json({ error: "Failed to login" });
  }
});

app.get("/api/me", async (req, res) => {
  const email = getAuthEmail(req);
  if (!email) return res.status(401).json({ error: "Unauthorized" });
  const user = await db.getUserByEmail(email);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ user: publicUser(user) });
});

app.post("/api/rewards/daily", async (req, res) => {
  const email = getAuthEmail(req);
  if (!email) return res.status(401).json({ error: "Unauthorized" });
  const user = await db.getUserByEmail(email);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const today = new Date().toISOString().slice(0, 10);
  if (user.lastDailyReward === today) return res.status(400).json({ error: "Daily reward already claimed" });

  user.lastDailyReward = today;
  user.streak += 1;
  const reward = 120 + Math.min(400, user.streak * 10);
  user.coins += reward;
  await db.updateUser(email, user);

  res.json({ reward, user: publicUser(user) });
});

app.post("/api/rewards/secret", async (req, res) => {
  const email = getAuthEmail(req);
  const { code } = req.body || {};
  if (!email) return res.status(401).json({ error: "Unauthorized" });
  const user = await db.getUserByEmail(email);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (code !== SECRET_CODE) return res.status(400).json({ error: "Invalid secret code" });

  if (user.secretCodeClaimed) return res.status(400).json({ error: "Secret code already redeemed" });
  user.secretCodeClaimed = true;
  user.coins += 1000;
  await db.updateUser(email, user);

  res.json({ coinsAwarded: 1000, user: publicUser(user) });
});

app.get("/api/quizzes", async (req, res) => {
  const quizzes = await db.listQuizzes();
  res.json(quizzes.map((q) => ({ id: q.id, title: q.title, topic: q.topic, questions: q.questions.length, createdBy: q.createdBy })));
});

app.post("/api/quizzes", async (req, res) => {
  const email = getAuthEmail(req);
  const { title, topic, questions } = req.body || {};
  if (!email) return res.status(401).json({ error: "Unauthorized" });
  const user = await db.getUserByEmail(email);
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

  await db.createQuiz(quiz);
  res.json({ ok: true, quizId: quiz.id });
});

app.post("/api/tutor/explain", (req, res) => {
  const { options, correctIndex } = req.body || {};
  const correct = Array.isArray(options) ? options[Number(correctIndex) || 0] : "the correct option";
  const response = `Let's break it down:\n- Focus on key terms in the question.\n- Eliminate choices that conflict with known facts.\n- The best answer is "${correct}" because it matches the core concept.\nTip: Try explaining this in your own words to lock in the idea.`;
  res.json({ explanation: response, source: "quizwitme-ai-tutor" });
});

app.post("/api/moderation/action", async (req, res) => {
  const email = getAuthEmail(req);
  const { targetEmail, action, role } = req.body || {};
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const actor = await db.getUserByEmail(email);
  const target = await db.getUserByEmail((targetEmail || "").toLowerCase());
  if (!actor || !target) return res.status(404).json({ error: "User not found" });
  if (!["moderator", "owner"].includes(actor.role)) return res.status(403).json({ error: "Moderator or owner access required" });

  if (action === "ban") target.banned = true;
  if (action === "unban") target.banned = false;
  if (action === "setRole" && actor.role === "owner") target.role = role;

  await db.updateUser(target.email, target);
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
    if (!code || !token) return;

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

server.listen(PORT, async () => {
  await db.init();
  console.log(`Quizwitme server running at http://localhost:${PORT}`);
  console.log(`Storage mode: ${process.env.DATABASE_URL ? "PostgreSQL" : "JSON file"}`);
});
