const express = require("express");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

/* =========================
   TELEGRAM BOT
========================= */

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

let users = new Set();
const adminId = 7837011810;

bot.onText(/\/start/, (msg) => {
  users.add(msg.from.id);

  bot.sendMessage(
    msg.chat.id,
`🎮 Добро пожаловать в *ArTap!*

👆 Тапай по Artemwe  
🪙 Зарабатывай монеты  
⚡ Прокачивай силу клика  
🏆 Стань лучшим игроком  

🚀 Начни играть прямо сейчас!`,
    {
      parse_mode: "Markdown"
    }
  );
});

bot.onText(/\/players/, (msg) => {
  if (msg.from.id === adminId) {
    bot.sendMessage(msg.chat.id, "👥 Игроков: " + users.size);
  }
});

/* =========================
   GAME DATABASE
========================= */

const DB = path.join(__dirname, "players.json");

const DEFAULT_PLAYER = {
  score: 0,
  clickPower: 1,
  boughtClick: false,
  boughtSpeed: false,
  incomeSeconds: 5,
  fastEnergy: false,
  energyDelay: 3000,
  currentSkin: "FA9BC995-07D9-4B53-AB69-3AD0DAD933B8.png",
  maxEnergy: 500,
  energy: 500,
  energyUpgradeCount: 0,
  task10kDone: false,
  taskBuy1UpgradeDone: false,
  taskEmptyEnergyDone: false,
  task5000EnergyDone: false,
  energyWasZero: false,
  lastTime: Date.now()
};

if (!fs.existsSync(DB)) {
  fs.writeFileSync(DB, JSON.stringify({}, null, 2), "utf8");
}

function readDB() {
  try {
    const raw = fs.readFileSync(DB, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.log("Ошибка чтения БД:", error);
    return {};
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.log("Ошибка сохранения БД:", error);
  }
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePlayer(player = {}) {
  const normalized = {
    ...DEFAULT_PLAYER,
    ...player
  };

  normalized.score = toNumber(player.score ?? player.coins, DEFAULT_PLAYER.score);
  normalized.clickPower = toNumber(player.clickPower ?? player.click, DEFAULT_PLAYER.clickPower);
  normalized.boughtClick = Boolean(player.boughtClick);
  normalized.boughtSpeed = Boolean(player.boughtSpeed);
  normalized.incomeSeconds = toNumber(player.incomeSeconds, DEFAULT_PLAYER.incomeSeconds);
  normalized.fastEnergy = Boolean(player.fastEnergy);
  normalized.energyDelay = normalized.fastEnergy ? 2000 : toNumber(player.energyDelay, DEFAULT_PLAYER.energyDelay);
  normalized.currentSkin = player.currentSkin || DEFAULT_PLAYER.currentSkin;
  normalized.maxEnergy = toNumber(player.maxEnergy, DEFAULT_PLAYER.maxEnergy);
  normalized.energy = toNumber(player.energy, normalized.maxEnergy);
  normalized.energyUpgradeCount = toNumber(player.energyUpgradeCount, DEFAULT_PLAYER.energyUpgradeCount);
  normalized.task10kDone = Boolean(player.task10kDone);
  normalized.taskBuy1UpgradeDone = Boolean(player.taskBuy1UpgradeDone);
  normalized.taskEmptyEnergyDone = Boolean(player.taskEmptyEnergyDone);
  normalized.task5000EnergyDone = Boolean(player.task5000EnergyDone);
  normalized.energyWasZero = Boolean(player.energyWasZero);
  normalized.lastTime = toNumber(player.lastTime, Date.now());

  if (normalized.maxEnergy < 500) normalized.maxEnergy = 500;
  if (normalized.maxEnergy > 5000) normalized.maxEnergy = 5000;

  if (normalized.energy < 0) normalized.energy = 0;
  if (normalized.energy > normalized.maxEnergy) normalized.energy = normalized.maxEnergy;

  if (normalized.clickPower < 1) normalized.clickPower = 1;
  if (normalized.incomeSeconds < 1) normalized.incomeSeconds = 1;
  if (normalized.energyUpgradeCount < 0) normalized.energyUpgradeCount = 0;
  if (normalized.score < 0) normalized.score = 0;

  return normalized;
}

function playerResponse(player) {
  const normalized = normalizePlayer(player);

  return {
    ...normalized,

    // для совместимости со старым index.html
    coins: normalized.score,
    click: normalized.clickPower
  };
}

/* =========================
   API
========================= */

app.get("/load/:id", (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "Нет ID игрока" });
    }

    const db = readDB();

    if (!db[id]) {
      db[id] = { ...DEFAULT_PLAYER };
    }

    db[id] = normalizePlayer(db[id]);
    saveDB(db);

    return res.json(playerResponse(db[id]));
  } catch (error) {
    console.log("Ошибка /load:", error);
    return res.status(500).json({ error: "Ошибка загрузки" });
  }
});

app.post("/save/:id", (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "Нет ID игрока" });
    }

    const db = readDB();
    const oldPlayer = normalizePlayer(db[id] || DEFAULT_PLAYER);
    const newData = req.body || {};

    const merged = {
      ...oldPlayer,
      ...newData,

      // совместимость со старыми именами полей
      score: newData.score ?? newData.coins ?? oldPlayer.score,
      clickPower: newData.clickPower ?? newData.click ?? oldPlayer.clickPower,
      currentSkin: newData.currentSkin ?? oldPlayer.currentSkin,
      task10kDone: newData.task10kDone ?? oldPlayer.task10kDone,
      taskBuy1UpgradeDone: newData.taskBuy1UpgradeDone ?? oldPlayer.taskBuy1UpgradeDone,
      taskEmptyEnergyDone: newData.taskEmptyEnergyDone ?? oldPlayer.taskEmptyEnergyDone,
      task5000EnergyDone: newData.task5000EnergyDone ?? oldPlayer.task5000EnergyDone,
      energyWasZero: newData.energyWasZero ?? oldPlayer.energyWasZero,
      lastTime: Date.now()
    };

    db[id] = normalizePlayer(merged);
    saveDB(db);

    return res.json({
      status: "ok",
      player: playerResponse(db[id])
    });
  } catch (error) {
    console.log("Ошибка /save:", error);
    return res.status(500).json({ error: "Ошибка сохранения" });
  }
});

/* =========================
   PAGES
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});
