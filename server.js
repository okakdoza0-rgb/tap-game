const express = require("express");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const { Pool } = require("pg");

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

function getTelegramNickname(user = {}) {
  const firstName = String(user.first_name || "").trim();
  const username = String(user.username || "").trim();

  if (firstName) return firstName;
  if (username) return username;
  return "Игрок";
}

function getAchievementsText(player) {
  const achievements = [];

  if (player.task10kDone) achievements.push("✅ Набрал 10K монет");
  if (player.taskBuy1UpgradeDone) achievements.push("✅ Купил 1 улучшение");
  if (player.taskEmptyEnergyDone) achievements.push("✅ Потратил всю энергию");
  if (player.task5000EnergyDone) achievements.push("✅ Дошёл до 5000 энергии");

  if (!achievements.length) {
    return "Нет выполненных достижений";
  }

  return achievements.join("\n");
}

bot.onText(/\/start/, async (msg) => {
  users.add(msg.from.id);

  try {
    await getOrCreatePlayer(String(msg.from.id), {
      nickname: getTelegramNickname(msg.from)
    });
  } catch (error) {
    console.log("Ошибка создания игрока из /start:", error);
  }

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
   ВЫДАЧА МОНЕТ ЧЕРЕЗ БОТА
   /give ID СУММА
========================= */

bot.onText(/\/give\s+(\S+)\s+(\d+)/, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1]).trim();
    const amount = Math.floor(Number(match[2]));

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(msg.chat.id, "❌ Неверная сумма");
    }

    const player = await getOrCreatePlayer(playerId);

    const updatedPlayer = {
      ...player,
      score: Number(player.score || 0) + amount,
      lastTime: Date.now()
    };

    const savedPlayer = await savePlayer(playerId, updatedPlayer);

    await bot.sendMessage(
      msg.chat.id,
      `✅ Игроку ${playerId} начислено ${amount} монет\n💰 Теперь у него: ${savedPlayer.score} монет`
    );

    try {
      if (String(msg.chat.id) !== playerId) {
        await bot.sendMessage(
          playerId,
          `🎁 Вам начислено ${amount} монет в ArTap!`
        );
      }
    } catch (notifyError) {
      console.log("Не удалось уведомить игрока:", notifyError.message);
    }
  } catch (error) {
    console.log("Ошибка /give:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при начислении монет");
  }
});

/* =========================
   СНЯТИЕ МОНЕТ
   /take ID СУММА
========================= */

bot.onText(/\/take\s+(\S+)\s+(\d+)/, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1]).trim();
    const amount = Math.floor(Number(match[2]));

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(msg.chat.id, "❌ Неверная сумма");
    }

    const player = await getOrCreatePlayer(playerId);
    const currentScore = Number(player.score || 0);
    const newScore = Math.max(0, currentScore - amount);

    const updatedPlayer = {
      ...player,
      score: newScore,
      lastTime: Date.now()
    };

    const savedPlayer = await savePlayer(playerId, updatedPlayer);
    const removed = currentScore - newScore;

    await bot.sendMessage(
      msg.chat.id,
      `➖ У игрока ${playerId} снято ${removed} монет\n💰 Теперь у него: ${savedPlayer.score} монет`
    );

    try {
      if (String(msg.chat.id) !== playerId) {
        await bot.sendMessage(
          playerId,
          `➖ У вас снято ${removed} монет в ArTap`
        );
      }
    } catch (notifyError) {
      console.log("Не удалось уведомить игрока:", notifyError.message);
    }
  } catch (error) {
    console.log("Ошибка /take:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при снятии монет");
  }
});

/* =========================
   ПРОСМОТР ПРОФИЛЯ ИГРОКА
   /profile ID
========================= */

bot.onText(/\/profile\s+(\S+)/, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1]).trim();

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    const player = await getOrCreatePlayer(playerId);

    const achievementsText = getAchievementsText(player);

    await bot.sendMessage(
      msg.chat.id,
`👤 Профиль игрока

🆔 ID: ${playerId}
📛 Ник: ${player.nickname || "Игрок"}

🪙 Монеты: ${player.score}
⚡ Сила клика: ${player.clickPower}
🔋 Энергия: ${player.energy}/${player.maxEnergy}
⏱ Доход: ${player.clickPower} / ${player.incomeSeconds} сек
⚡ Реген энергии: ${player.fastEnergy ? 2 : 3} сек

🏆 Достижения:
${achievementsText}`
    );
  } catch (error) {
    console.log("Ошибка /profile:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при просмотре профиля");
  }
});

/* =========================
   POSTGRES DATABASE
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

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
  lastTime: Date.now(),
  nickname: "Игрок"
};

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
  normalized.nickname = String(player.nickname || DEFAULT_PLAYER.nickname).trim() || "Игрок";

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
    coins: normalized.score,
    click: normalized.clickPower
  };
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      score INTEGER NOT NULL DEFAULT 0,
      click_power INTEGER NOT NULL DEFAULT 1,
      bought_click BOOLEAN NOT NULL DEFAULT FALSE,
      bought_speed BOOLEAN NOT NULL DEFAULT FALSE,
      income_seconds INTEGER NOT NULL DEFAULT 5,
      fast_energy BOOLEAN NOT NULL DEFAULT FALSE,
      energy_delay INTEGER NOT NULL DEFAULT 3000,
      current_skin TEXT NOT NULL DEFAULT 'FA9BC995-07D9-4B53-AB69-3AD0DAD933B8.png',
      max_energy INTEGER NOT NULL DEFAULT 500,
      energy INTEGER NOT NULL DEFAULT 500,
      energy_upgrade_count INTEGER NOT NULL DEFAULT 0,
      task10k_done BOOLEAN NOT NULL DEFAULT FALSE,
      task_buy1upgrade_done BOOLEAN NOT NULL DEFAULT FALSE,
      task_empty_energy_done BOOLEAN NOT NULL DEFAULT FALSE,
      task5000energy_done BOOLEAN NOT NULL DEFAULT FALSE,
      energy_was_zero BOOLEAN NOT NULL DEFAULT FALSE,
      last_time BIGINT NOT NULL DEFAULT 0,
      nickname TEXT NOT NULL DEFAULT 'Игрок'
    )
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS nickname TEXT NOT NULL DEFAULT 'Игрок'
  `);
}

function rowToPlayer(row) {
  return {
    score: row.score,
    clickPower: row.click_power,
    boughtClick: row.bought_click,
    boughtSpeed: row.bought_speed,
    incomeSeconds: row.income_seconds,
    fastEnergy: row.fast_energy,
    energyDelay: row.energy_delay,
    currentSkin: row.current_skin,
    maxEnergy: row.max_energy,
    energy: row.energy,
    energyUpgradeCount: row.energy_upgrade_count,
    task10kDone: row.task10k_done,
    taskBuy1UpgradeDone: row.task_buy1upgrade_done,
    taskEmptyEnergyDone: row.task_empty_energy_done,
    task5000EnergyDone: row.task5000energy_done,
    energyWasZero: row.energy_was_zero,
    lastTime: Number(row.last_time),
    nickname: row.nickname
  };
}

async function getPlayer(id) {
  const result = await pool.query("SELECT * FROM players WHERE id = $1", [id]);

  if (result.rows.length === 0) {
    return null;
  }

  return rowToPlayer(result.rows[0]);
}

async function createPlayer(id, extra = {}) {
  const p = {
    ...DEFAULT_PLAYER,
    ...extra
  };

  await pool.query(
    `INSERT INTO players (
      id, score, click_power, bought_click, bought_speed, income_seconds,
      fast_energy, energy_delay, current_skin, max_energy, energy,
      energy_upgrade_count, task10k_done, task_buy1upgrade_done,
      task_empty_energy_done, task5000energy_done, energy_was_zero, last_time, nickname
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
    )
    ON CONFLICT (id) DO NOTHING`,
    [
      id,
      p.score,
      p.clickPower,
      p.boughtClick,
      p.boughtSpeed,
      p.incomeSeconds,
      p.fastEnergy,
      p.energyDelay,
      p.currentSkin,
      p.maxEnergy,
      p.energy,
      p.energyUpgradeCount,
      p.task10kDone,
      p.taskBuy1UpgradeDone,
      p.taskEmptyEnergyDone,
      p.task5000EnergyDone,
      p.energyWasZero,
      p.lastTime,
      p.nickname
    ]
  );
}

async function getOrCreatePlayer(id, extra = {}) {
  let player = await getPlayer(id);

  if (!player) {
    await createPlayer(id, extra);
    player = await getPlayer(id);
  }

  return normalizePlayer({
    ...player,
    ...extra
  });
}

async function savePlayer(id, playerData) {
  const p = normalizePlayer(playerData);

  await pool.query(
    `INSERT INTO players (
      id, score, click_power, bought_click, bought_speed, income_seconds,
      fast_energy, energy_delay, current_skin, max_energy, energy,
      energy_upgrade_count, task10k_done, task_buy1upgrade_done,
      task_empty_energy_done, task5000energy_done, energy_was_zero, last_time, nickname
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
    )
    ON CONFLICT (id) DO UPDATE SET
      score = EXCLUDED.score,
      click_power = EXCLUDED.click_power,
      bought_click = EXCLUDED.bought_click,
      bought_speed = EXCLUDED.bought_speed,
      income_seconds = EXCLUDED.income_seconds,
      fast_energy = EXCLUDED.fast_energy,
      energy_delay = EXCLUDED.energy_delay,
      current_skin = EXCLUDED.current_skin,
      max_energy = EXCLUDED.max_energy,
      energy = EXCLUDED.energy,
      energy_upgrade_count = EXCLUDED.energy_upgrade_count,
      task10k_done = EXCLUDED.task10k_done,
      task_buy1upgrade_done = EXCLUDED.task_buy1upgrade_done,
      task_empty_energy_done = EXCLUDED.task_empty_energy_done,
      task5000energy_done = EXCLUDED.task5000energy_done,
      energy_was_zero = EXCLUDED.energy_was_zero,
      last_time = EXCLUDED.last_time,
      nickname = EXCLUDED.nickname`,
    [
      id,
      p.score,
      p.clickPower,
      p.boughtClick,
      p.boughtSpeed,
      p.incomeSeconds,
      p.fastEnergy,
      p.energyDelay,
      p.currentSkin,
      p.maxEnergy,
      p.energy,
      p.energyUpgradeCount,
      p.task10kDone,
      p.taskBuy1UpgradeDone,
      p.taskEmptyEnergyDone,
      p.task5000EnergyDone,
      p.energyWasZero,
      Date.now(),
      p.nickname
    ]
  );

  return getOrCreatePlayer(id);
}

/* =========================
   API
========================= */

app.get("/load/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "Нет ID игрока" });
    }

    const player = await getOrCreatePlayer(id);
    return res.json(playerResponse(player));
  } catch (error) {
    console.log("Ошибка /load:", error);
    return res.status(500).json({ error: "Ошибка загрузки" });
  }
});

app.post("/save/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ error: "Нет ID игрока" });
    }

    const oldPlayer = await getOrCreatePlayer(id);
    const newData = req.body || {};

    const merged = {
      ...oldPlayer,
      ...newData,
      score: newData.score ?? newData.coins ?? oldPlayer.score,
      clickPower: newData.clickPower ?? newData.click ?? oldPlayer.clickPower,
      currentSkin: newData.currentSkin ?? oldPlayer.currentSkin,
      nickname: newData.nickname ?? oldPlayer.nickname,
      task10kDone: newData.task10kDone ?? oldPlayer.task10kDone,
      taskBuy1UpgradeDone: newData.taskBuy1UpgradeDone ?? oldPlayer.taskBuy1UpgradeDone,
      taskEmptyEnergyDone: newData.taskEmptyEnergyDone ?? oldPlayer.taskEmptyEnergyDone,
      task5000EnergyDone: newData.task5000EnergyDone ?? oldPlayer.task5000EnergyDone,
      energyWasZero: newData.energyWasZero ?? oldPlayer.energyWasZero,
      lastTime: Date.now()
    };

    const savedPlayer = await savePlayer(id, merged);

    return res.json({
      status: "ok",
      player: playerResponse(savedPlayer)
    });
  } catch (error) {
    console.log("Ошибка /save:", error);
    return res.status(500).json({ error: "Ошибка сохранения" });
  }
});

/* =========================
   TOP 50 PLAYERS
========================= */

app.get("/top", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nickname, score
      FROM players
      WHERE
        nickname IS NOT NULL
        AND TRIM(nickname) <> ''
        AND nickname <> 'Игрок'
        AND id NOT LIKE 'local_%'
      ORDER BY score DESC
      LIMIT 50
    `);

    const top = result.rows.map((row, index) => ({
      place: index + 1,
      id: row.id,
      nickname: row.nickname || "Игрок",
      score: Number(row.score) || 0
    }));

    return res.json(top);
  } catch (error) {
    console.log("Ошибка /top:", error);
    return res.status(500).json({ error: "Ошибка получения топа" });
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

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Server started on port " + PORT);
    });
  })
  .catch((error) => {
    console.log("Ошибка запуска БД:", error);
    process.exit(1);
  });
