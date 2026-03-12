const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const DB = path.join(__dirname, "players.json");

const DEFAULT_PLAYER = {
  coins: 0,
  energy: 500,
  maxEnergy: 500,
  click: 1,

  boughtClick: false,
  boughtSpeed: false,
  incomeSeconds: 5,

  fastEnergy: false,
  currentSkin: "FA9BC995-07D9-4B53-AB69-3AD0DAD933B8.png",
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

function normalizePlayer(player = {}) {
  const normalized = {
    ...DEFAULT_PLAYER,
    ...player
  };

  if (typeof normalized.coins !== "number" || isNaN(normalized.coins)) {
    normalized.coins = 0;
  }

  if (typeof normalized.energy !== "number" || isNaN(normalized.energy)) {
    normalized.energy = 500;
  }

  if (typeof normalized.maxEnergy !== "number" || isNaN(normalized.maxEnergy)) {
    normalized.maxEnergy = 500;
  }

  if (typeof normalized.click !== "number" || isNaN(normalized.click)) {
    normalized.click = 1;
  }

  if (typeof normalized.incomeSeconds !== "number" || isNaN(normalized.incomeSeconds)) {
    normalized.incomeSeconds = 5;
  }

  if (typeof normalized.energyUpgradeCount !== "number" || isNaN(normalized.energyUpgradeCount)) {
    normalized.energyUpgradeCount = 0;
  }

  if (normalized.maxEnergy < 500) normalized.maxEnergy = 500;
  if (normalized.energy < 0) normalized.energy = 0;
  if (normalized.energy > normalized.maxEnergy) normalized.energy = normalized.maxEnergy;
  if (normalized.click < 1) normalized.click = 1;
  if (normalized.incomeSeconds < 1) normalized.incomeSeconds = 1;
  if (normalized.coins < 0) normalized.coins = 0;

  return normalized;
}

app.get("/load/:id", (req, res) => {
  const id = String(req.params.id || "").trim();

  if (!id) {
    return res.status(400).json({ error: "Нет ID игрока" });
  }

  const db = readDB();

  if (!db[id]) {
    db[id] = { ...DEFAULT_PLAYER };
  } else {
    db[id] = normalizePlayer(db[id]);
  }

  saveDB(db);
  res.json(db[id]);
});

app.post("/save/:id", (req, res) => {
  const id = String(req.params.id || "").trim();

  if (!id) {
    return res.status(400).json({ error: "Нет ID игрока" });
  }

  const db = readDB();
  const oldPlayer = db[id] ? normalizePlayer(db[id]) : { ...DEFAULT_PLAYER };
  const body = req.body || {};

  db[id] = normalizePlayer({
    ...oldPlayer,
    ...body,
    lastTime: Date.now()
  });

  saveDB(db);

  res.json({
    status: "ok",
    player: db[id]
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});
