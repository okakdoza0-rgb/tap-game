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
const REF_REWARD = 1500;
const ONLINE_LIMIT_MS = 30000;

function getTelegramNickname(user = {}) {
  const firstName = String(user.first_name || "").trim();
  const username = String(user.username || "").trim();

  if (firstName) return firstName;
  if (username) return username;
  return "Игрок";
}

function getEnergyRegenText(player) {
  const delay = Number(player.energyDelay) || 3000;

  if (delay <= 1000) return "1 сек";
  if (delay <= 2000) return "2 сек";
  return "3 сек";
}

function getAchievementsText(player) {
  const achievements = [];

  if (player.task10kDone) achievements.push("✅ Набрал 10K монет");
  if (player.task1mDone) achievements.push("✅ Набрал 1M монет");
  if (player.task4ClickDone) achievements.push("✅ Дошёл до 4 клика");
  if (player.task3RefsDone) achievements.push("✅ Пригласил 3 друзей");
  if (player.taskBuy1UpgradeDone) achievements.push("✅ Купил 1 улучшение");
  if (player.taskEmptyEnergyDone) achievements.push("✅ Потратил всю энергию");
  if (player.task5000EnergyDone) achievements.push("✅ Дошёл до 5000 энергии");

  if (!achievements.length) {
    return "Нет выполненных достижений";
  }

  return achievements.join("\n");
}

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
  clickUpgradeLevel: 0,
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
  task1mDone: false,
  task4ClickDone: false,
  task3RefsDone: false,
  reached1m: false,
  taskBuy1UpgradeDone: false,
  taskEmptyEnergyDone: false,
  task5000EnergyDone: false,
  energyWasZero: false,
  lastTime: Date.now(),
  nickname: "Игрок",
  referralsCount: 0,
  referredBy: null
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
  normalized.clickUpgradeLevel = toNumber(
    player.clickUpgradeLevel,
    Math.max(0, normalized.clickPower - 1)
  );

  normalized.boughtClick = Boolean(player.boughtClick || normalized.clickPower > 1);
  normalized.boughtSpeed = Boolean(player.boughtSpeed);
  normalized.incomeSeconds = toNumber(player.incomeSeconds, DEFAULT_PLAYER.incomeSeconds);

  normalized.energyDelay = toNumber(player.energyDelay, DEFAULT_PLAYER.energyDelay);
  if (normalized.energyDelay < 1000) normalized.energyDelay = 1000;
  if (normalized.energyDelay > 3000) normalized.energyDelay = 3000;

  normalized.fastEnergy = normalized.energyDelay < 3000 || Boolean(player.fastEnergy);

  normalized.currentSkin = player.currentSkin || DEFAULT_PLAYER.currentSkin;
  normalized.maxEnergy = toNumber(player.maxEnergy, DEFAULT_PLAYER.maxEnergy);
  normalized.energy = toNumber(player.energy, normalized.maxEnergy);
  normalized.energyUpgradeCount = toNumber(player.energyUpgradeCount, DEFAULT_PLAYER.energyUpgradeCount);

  normalized.task10kDone = Boolean(player.task10kDone);
  normalized.task1mDone = Boolean(player.task1mDone);
  normalized.task4ClickDone = Boolean(player.task4ClickDone);
  normalized.task3RefsDone = Boolean(player.task3RefsDone);
  normalized.reached1m = Boolean(player.reached1m);
  normalized.taskBuy1UpgradeDone = Boolean(player.taskBuy1UpgradeDone);
  normalized.taskEmptyEnergyDone = Boolean(player.taskEmptyEnergyDone);
  normalized.task5000EnergyDone = Boolean(player.task5000EnergyDone);
  normalized.energyWasZero = Boolean(player.energyWasZero);
  normalized.lastTime = toNumber(player.lastTime, Date.now());
  normalized.nickname = String(player.nickname || DEFAULT_PLAYER.nickname).trim() || "Игрок";
  normalized.referralsCount = toNumber(player.referralsCount, 0);
  normalized.referredBy = player.referredBy ? String(player.referredBy).trim() : null;

  if (normalized.score >= 1000000) {
    normalized.reached1m = true;
  }

  if (normalized.maxEnergy < 500) normalized.maxEnergy = 500;
  if (normalized.maxEnergy > 5000) normalized.maxEnergy = 5000;

  if (normalized.energy < 0) normalized.energy = 0;
  if (normalized.energy > normalized.maxEnergy) normalized.energy = normalized.maxEnergy;

  if (normalized.clickPower < 1) normalized.clickPower = 1;
  if (normalized.clickPower > 4) normalized.clickPower = 4;

  if (normalized.clickUpgradeLevel < 0) normalized.clickUpgradeLevel = 0;
  if (normalized.clickUpgradeLevel > 3) normalized.clickUpgradeLevel = 3;

  if (normalized.incomeSeconds < 1) normalized.incomeSeconds = 1;
  if (normalized.energyUpgradeCount < 0) normalized.energyUpgradeCount = 0;
  if (normalized.score < 0) normalized.score = 0;
  if (normalized.referralsCount < 0) normalized.referralsCount = 0;

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
      click_upgrade_level INTEGER NOT NULL DEFAULT 0,
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
      task1m_done BOOLEAN NOT NULL DEFAULT FALSE,
      task4click_done BOOLEAN NOT NULL DEFAULT FALSE,
      task3refs_done BOOLEAN NOT NULL DEFAULT FALSE,
      reached1m BOOLEAN NOT NULL DEFAULT FALSE,
      task_buy1upgrade_done BOOLEAN NOT NULL DEFAULT FALSE,
      task_empty_energy_done BOOLEAN NOT NULL DEFAULT FALSE,
      task5000energy_done BOOLEAN NOT NULL DEFAULT FALSE,
      energy_was_zero BOOLEAN NOT NULL DEFAULT FALSE,
      last_time BIGINT NOT NULL DEFAULT 0,
      nickname TEXT NOT NULL DEFAULT 'Игрок',
      referrals_count INTEGER NOT NULL DEFAULT 0,
      referred_by TEXT
    )
  `);

  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS nickname TEXT NOT NULL DEFAULT 'Игрок'`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS click_upgrade_level INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS task1m_done BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS task4click_done BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS task3refs_done BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS reached1m BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referrals_count INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referred_by TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_users (
      id TEXT PRIMARY KEY,
      first_started_at BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS online_players (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL DEFAULT 'Игрок',
      last_seen BIGINT NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    INSERT INTO bot_users (id, first_started_at)
    SELECT id, COALESCE(last_time, 0)
    FROM players
    ON CONFLICT (id) DO NOTHING
  `);
}

function rowToPlayer(row) {
  return {
    score: row.score,
    clickPower: row.click_power,
    clickUpgradeLevel: row.click_upgrade_level,
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
    task1mDone: row.task1m_done,
    task4ClickDone: row.task4click_done,
    task3RefsDone: row.task3refs_done,
    reached1m: row.reached1m,
    taskBuy1UpgradeDone: row.task_buy1upgrade_done,
    taskEmptyEnergyDone: row.task_empty_energy_done,
    task5000EnergyDone: row.task5000energy_done,
    energyWasZero: row.energy_was_zero,
    lastTime: Number(row.last_time),
    nickname: row.nickname,
    referralsCount: row.referrals_count,
    referredBy: row.referred_by
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
  const p = normalizePlayer({
    ...DEFAULT_PLAYER,
    ...extra
  });

  await pool.query(
    `INSERT INTO players (
      id, score, click_power, click_upgrade_level, bought_click, bought_speed, income_seconds,
      fast_energy, energy_delay, current_skin, max_energy, energy,
      energy_upgrade_count, task10k_done, task1m_done, task4click_done, task3refs_done, reached1m, task_buy1upgrade_done,
      task_empty_energy_done, task5000energy_done, energy_was_zero, last_time, nickname,
      referrals_count, referred_by
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
    )
    ON CONFLICT (id) DO NOTHING`,
    [
      id,
      p.score,
      p.clickPower,
      p.clickUpgradeLevel,
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
      p.task1mDone,
      p.task4ClickDone,
      p.task3RefsDone,
      p.reached1m,
      p.taskBuy1UpgradeDone,
      p.taskEmptyEnergyDone,
      p.task5000EnergyDone,
      p.energyWasZero,
      p.lastTime,
      p.nickname,
      p.referralsCount,
      p.referredBy
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
      id, score, click_power, click_upgrade_level, bought_click, bought_speed, income_seconds,
      fast_energy, energy_delay, current_skin, max_energy, energy,
      energy_upgrade_count, task10k_done, task1m_done, task4click_done, task3refs_done, reached1m, task_buy1upgrade_done,
      task_empty_energy_done, task5000energy_done, energy_was_zero, last_time, nickname,
      referrals_count, referred_by
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
    )
    ON CONFLICT (id) DO UPDATE SET
      score = EXCLUDED.score,
      click_power = EXCLUDED.click_power,
      click_upgrade_level = EXCLUDED.click_upgrade_level,
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
      task1m_done = EXCLUDED.task1m_done,
      task4click_done = EXCLUDED.task4click_done,
      task3refs_done = EXCLUDED.task3refs_done,
      reached1m = EXCLUDED.reached1m,
      task_buy1upgrade_done = EXCLUDED.task_buy1upgrade_done,
      task_empty_energy_done = EXCLUDED.task_empty_energy_done,
      task5000energy_done = EXCLUDED.task5000energy_done,
      energy_was_zero = EXCLUDED.energy_was_zero,
      last_time = EXCLUDED.last_time,
      nickname = EXCLUDED.nickname,
      referrals_count = EXCLUDED.referrals_count,
      referred_by = EXCLUDED.referred_by`,
    [
      id,
      p.score,
      p.clickPower,
      p.clickUpgradeLevel,
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
      p.task1mDone,
      p.task4ClickDone,
      p.task3RefsDone,
      p.reached1m,
      p.taskBuy1UpgradeDone,
      p.taskEmptyEnergyDone,
      p.task5000EnergyDone,
      p.energyWasZero,
      Date.now(),
      p.nickname,
      p.referralsCount,
      p.referredBy
    ]
  );

  return getOrCreatePlayer(id);
}

async function deletePlayer(id) {
  const result = await pool.query("DELETE FROM players WHERE id = $1", [id]);
  return result.rowCount > 0;
}

async function hasBotStartedBefore(id) {
  const result = await pool.query(
    "SELECT id FROM bot_users WHERE id = $1 LIMIT 1",
    [id]
  );
  return result.rows.length > 0;
}

async function markBotStarted(id) {
  await pool.query(
    `INSERT INTO bot_users (id, first_started_at)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [id, Date.now()]
  );
}

async function updateOnlinePlayer(id, nickname = "Игрок") {
  await pool.query(
    `INSERT INTO online_players (id, nickname, last_seen)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       nickname = EXCLUDED.nickname,
       last_seen = EXCLUDED.last_seen`,
    [id, nickname, Date.now()]
  );
}

async function getOnlinePlayers() {
  const minTime = Date.now() - ONLINE_LIMIT_MS;

  const result = await pool.query(
    `SELECT id, nickname, last_seen
     FROM online_players
     WHERE last_seen >= $1
     ORDER BY last_seen DESC
     LIMIT 50`,
    [minTime]
  );

  return result.rows;
}

/* =========================
   /START + РЕФЕРАЛКА
========================= */

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  users.add(msg.from.id);

  const playerId = String(msg.from.id);
  const nickname = getTelegramNickname(msg.from);
  const startParam = String(match?.[1] || "").trim();

  try {
    const startedBefore = await hasBotStartedBefore(playerId);

    let player = await getPlayer(playerId);
    if (!player) {
      await createPlayer(playerId, { nickname });
      player = await getPlayer(playerId);
    } else if (!player.nickname || player.nickname === "Игрок") {
      player = await savePlayer(playerId, {
        ...player,
        nickname
      });
    }

    await updateOnlinePlayer(playerId, nickname);

    if (
      !startedBefore &&
      startParam.startsWith("ref_")
    ) {
      const inviterId = startParam.replace("ref_", "").trim();

      if (
        inviterId &&
        inviterId !== playerId &&
        !player.referredBy
      ) {
        const inviter = await getPlayer(inviterId);

        if (inviter) {
          player = await savePlayer(playerId, {
            ...player,
            referredBy: inviterId
          });

          const updatedInviter = await savePlayer(inviterId, {
            ...inviter,
            score: Number(inviter.score || 0) + REF_REWARD,
            referralsCount: Number(inviter.referralsCount || 0) + 1
          });

          try {
            await bot.sendMessage(
              inviterId,
              `🎉 Новый игрок зашёл по твоей ссылке!\n🪙 Тебе начислено ${REF_REWARD} монет\n👥 Приглашено: ${updatedInviter.referralsCount || 0}`
            );
          } catch (notifyError) {
            console.log("Не удалось уведомить пригласившего:", notifyError.message);
          }
        }
      }
    }

    await markBotStarted(playerId);
  } catch (error) {
    console.log("Ошибка /start:", error);
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

bot.onText(/\/ref/, async (msg) => {
  try {
    const me = await bot.getMe();
    const playerId = String(msg.from.id);

    const player = await getOrCreatePlayer(playerId, {
      nickname: getTelegramNickname(msg.from)
    });

    await updateOnlinePlayer(playerId, player.nickname || "Игрок");

    const refLink = `https://t.me/${me.username}?start=ref_${playerId}`;

    await bot.sendMessage(
      msg.chat.id,
`👥 Твоя реферальная ссылка:

${refLink}

🎁 За каждого нового игрока ты получаешь ${REF_REWARD} монет
👤 Приглашено: ${player.referralsCount || 0}`
    );
  } catch (error) {
    console.log("Ошибка /ref:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при создании реферальной ссылки");
  }
});

bot.onText(/\/players/, (msg) => {
  if (msg.from.id === adminId) {
    bot.sendMessage(msg.chat.id, "👥 Игроков: " + users.size);
  }
});

bot.onText(/\/online/, async (msg) => {
  try {
    const players = await getOnlinePlayers();

    if (!players.length) {
      return bot.sendMessage(msg.chat.id, "🟢 Сейчас в игре никого нет");
    }

    const text = players
      .map((player, index) => `${index + 1}. ${player.nickname || "Игрок"} — ${player.id}`)
      .join("\n");

    await bot.sendMessage(
      msg.chat.id,
      `🟢 Сейчас в игре: ${players.length}\n\n${text}`
    );
  } catch (error) {
    console.log("Ошибка /online:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при получении онлайна");
  }
});

/* =========================
   ADMIN COMMANDS
========================= */

bot.onText(/\/admin/, (msg) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  bot.sendMessage(
    msg.chat.id,
`⚙️ Админ команды ArTap

/give ID СУММА
➜ Выдать монеты игроку

/take ID СУММА
➜ Забрать монеты у игрока

/profile ID
➜ Посмотреть профиль игрока

/deleteplayer ID
➜ Полностью удалить игрока

/players
➜ Посмотреть количество игроков

/online
➜ Кто сейчас в игре`
  );
});

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
⚡ Реген энергии: ${getEnergyRegenText(player)}
👥 Рефералов: ${player.referralsCount || 0}
🔗 Пришёл от: ${player.referredBy || "Никого"}

🏆 Достижения:
${achievementsText}`
    );
  } catch (error) {
    console.log("Ошибка /profile:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при просмотре профиля");
  }
});

bot.onText(/\/deleteplayer\s+(\S+)/, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1]).trim();

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    const deleted = await deletePlayer(playerId);

    if (!deleted) {
      return bot.sendMessage(msg.chat.id, `❌ Игрок ${playerId} не найден`);
    }

    users.delete(Number(playerId));

    await pool.query("DELETE FROM online_players WHERE id = $1", [playerId]);

    await bot.sendMessage(
      msg.chat.id,
      `🗑 Игрок ${playerId} полностью удалён из игры`
    );

    try {
      if (String(msg.chat.id) !== playerId) {
        await bot.sendMessage(
          playerId,
          `🗑 Ваш профиль удалён из ArTap`
        );
      }
    } catch (notifyError) {
      console.log("Не удалось уведомить игрока:", notifyError.message);
    }
  } catch (error) {
    console.log("Ошибка /deleteplayer:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при удалении игрока");
  }
});

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
      clickUpgradeLevel: newData.clickUpgradeLevel ?? oldPlayer.clickUpgradeLevel,
      boughtClick: newData.boughtClick ?? oldPlayer.boughtClick,
      boughtSpeed: newData.boughtSpeed ?? oldPlayer.boughtSpeed,
      incomeSeconds: newData.incomeSeconds ?? oldPlayer.incomeSeconds,
      fastEnergy: newData.fastEnergy ?? oldPlayer.fastEnergy,
      energyDelay: newData.energyDelay ?? oldPlayer.energyDelay,
      currentSkin: newData.currentSkin ?? oldPlayer.currentSkin,
      maxEnergy: newData.maxEnergy ?? oldPlayer.maxEnergy,
      energy: newData.energy ?? oldPlayer.energy,
      energyUpgradeCount: newData.energyUpgradeCount ?? oldPlayer.energyUpgradeCount,
      nickname: newData.nickname || oldPlayer.nickname,
      referralsCount: newData.referralsCount ?? oldPlayer.referralsCount,
      referredBy: oldPlayer.referredBy,
      task10kDone: newData.task10kDone ?? oldPlayer.task10kDone,
      task1mDone: newData.task1mDone ?? oldPlayer.task1mDone,
      task4ClickDone: newData.task4ClickDone ?? oldPlayer.task4ClickDone,
      task3RefsDone: newData.task3RefsDone ?? oldPlayer.task3RefsDone,
      reached1m: newData.reached1m ?? oldPlayer.reached1m,
      taskBuy1UpgradeDone: newData.taskBuy1UpgradeDone ?? oldPlayer.taskBuy1UpgradeDone,
      taskEmptyEnergyDone: newData.taskEmptyEnergyDone ?? oldPlayer.taskEmptyEnergyDone,
      task5000EnergyDone: newData.task5000EnergyDone ?? oldPlayer.task5000EnergyDone,
      energyWasZero: newData.energyWasZero ?? oldPlayer.energyWasZero,
      lastTime: Date.now()
    };

    const savedPlayer = await savePlayer(id, merged);

    if (savedPlayer?.nickname) {
      await updateOnlinePlayer(id, savedPlayer.nickname);
    }

    return res.json({
      status: "ok",
      player: playerResponse(savedPlayer)
    });
  } catch (error) {
    console.log("Ошибка /save:", error);
    return res.status(500).json({ error: "Ошибка сохранения" });
  }
});

app.post("/online/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const nickname = String(req.body?.nickname || "Игрок").trim() || "Игрок";

    if (!id) {
      return res.status(400).json({ error: "Нет ID игрока" });
    }

    await updateOnlinePlayer(id, nickname);

    return res.json({ status: "ok" });
  } catch (error) {
    console.log("Ошибка /online:", error);
    return res.status(500).json({ error: "Ошибка онлайна" });
  }
});

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
