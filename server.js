const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

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

function getPlayerWithDefaults(player = {}) {
  return {
    ...DEFAULT_PLAYER,
    ...player
  };
}

app.get("/load/:id", (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "Нет ID игрока" });
    }

    const db = readDB();

    if (!db[id]) {
      db[id] = { ...DEFAULT_PLAYER };
      saveDB(db);
    } else {
      db[id] = getPlayerWithDefaults(db[id]);
      saveDB(db);
    }

    return res.json(db[id]);
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
    const oldPlayer = db[id] || { ...DEFAULT_PLAYER };
    const newData = req.body || {};

    db[id] = {
      ...oldPlayer,
      ...newData,
      lastTime: Date.now()
    };

    if (typeof db[id].score !== "number" || isNaN(db[id].score)) {
      db[id].score = oldPlayer.score ?? 0;
    }

    if (typeof db[id].clickPower !== "number" || isNaN(db[id].clickPower)) {
      db[id].clickPower = oldPlayer.clickPower ?? 1;
    }

    if (typeof db[id].incomeSeconds !== "number" || isNaN(db[id].incomeSeconds)) {
      db[id].incomeSeconds = oldPlayer.incomeSeconds ?? 5;
    }

    if (typeof db[id].energy !== "number" || isNaN(db[id].energy)) {
      db[id].energy = oldPlayer.energy ?? 500;
    }

    if (typeof db[id].maxEnergy !== "number" || isNaN(db[id].maxEnergy)) {
      db[id].maxEnergy = oldPlayer.maxEnergy ?? 500;
    }

    if (typeof db[id].energyUpgradeCount !== "number" || isNaN(db[id].energyUpgradeCount)) {
      db[id].energyUpgradeCount = oldPlayer.energyUpgradeCount ?? 0;
    }

    if (db[id].energy > db[id].maxEnergy) {
      db[id].energy = db[id].maxEnergy;
    }

    if (db[id].energy < 0) {
      db[id].energy = 0;
    }

    saveDB(db);

    return res.json({
      status: "ok",
      player: db[id]
    });
  } catch (error) {
    console.log("Ошибка /save:", error);
    return res.status(500).json({ error: "Ошибка сохранения" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});
