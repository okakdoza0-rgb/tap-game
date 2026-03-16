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

const promoCreationState = new Map();
const promoInputState = new Map();
const maintenanceInputState = new Map();

/* напоминания */
const remindedPlayers = new Map();
const REMIND_AFTER_MS = 5 * 60 * 60 * 1000;
const REMIND_REPEAT_MS = 5 * 60 * 60 * 1000;
const REMIND_CHECK_MS = 10 * 60 * 1000;

/* проверка заморозки */
const FREEZE_CHECK_MS = 60 * 1000;

function getTelegramNickname(user = {}) {
  const firstName = String(user.first_name || "").trim();
  const username = String(user.username || "").trim();

  if (firstName) return firstName;
  if (username) return username;
  return "Игрок";
}

function normalizePromoCode(code) {
  return String(code || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
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

function formatDateTime(ms) {
  const value = Number(ms || 0);
  if (!value) return "Неизвестно";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Неизвестно";

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();

  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function parseFreezeDuration(raw) {
  const text = String(raw || "").trim().toLowerCase();
  const match = text.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);

  if (!match) return null;

  const value = Number(match[1]);
  const unit = String(match[2]).toLowerCase();

  if (!Number.isFinite(value) || value <= 0) return null;

  if (["m", "min", "mins", "minute", "minutes"].includes(unit)) {
    return value * 60 * 1000;
  }

  if (["h", "hr", "hrs", "hour", "hours"].includes(unit)) {
    return value * 60 * 60 * 1000;
  }

  if (["d", "day", "days"].includes(unit)) {
    return value * 24 * 60 * 60 * 1000;
  }

  return null;
}

function formatFreezeLeft(ms) {
  const value = Number(ms || 0);

  if (value <= 0) return "0 мин";

  const totalSeconds = Math.ceil(value / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days} д. ${hours} ч.`;
  }

  if (hours > 0) {
    return `${hours} ч. ${minutes} мин.`;
  }

  return `${Math.max(1, minutes)} мин.`;
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
  referredBy: null,
  loginCount: 0,
  lastLoginAt: 0
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
  normalized.loginCount = toNumber(player.loginCount, 0);
  normalized.lastLoginAt = toNumber(player.lastLoginAt, 0);

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
  if (normalized.loginCount < 0) normalized.loginCount = 0;
  if (normalized.lastLoginAt < 0) normalized.lastLoginAt = 0;

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
      referred_by TEXT,
      login_count INTEGER NOT NULL DEFAULT 0,
      last_login_at BIGINT NOT NULL DEFAULT 0
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
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_login_at BIGINT NOT NULL DEFAULT 0`);

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
    CREATE TABLE IF NOT EXISTS promo_codes (
      code TEXT PRIMARY KEY,
      reward INTEGER NOT NULL DEFAULT 0,
      max_activations INTEGER NOT NULL DEFAULT 1,
      current_activations INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      created_at BIGINT NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS promo_activations (
      code TEXT NOT NULL,
      player_id TEXT NOT NULL,
      activated_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (code, player_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_settings (
      key TEXT PRIMARY KEY,
      value_text TEXT,
      value_bool BOOLEAN,
      updated_at BIGINT NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    INSERT INTO game_settings (key, value_bool, value_text, updated_at)
    VALUES ('maintenance', FALSE, '🔧 Сейчас идут техработы. Зайди позже.', $1)
    ON CONFLICT (key) DO NOTHING
  `, [Date.now()]);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS banned_players (
      id TEXT PRIMARY KEY,
      reason TEXT,
      banned_at BIGINT NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS frozen_players (
      id TEXT PRIMARY KEY,
      reason TEXT,
      frozen_until BIGINT NOT NULL DEFAULT 0,
      frozen_at BIGINT NOT NULL DEFAULT 0
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
    referredBy: row.referred_by,
    loginCount: Number(row.login_count || 0),
    lastLoginAt: Number(row.last_login_at || 0)
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
      referrals_count, referred_by, login_count, last_login_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
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
      p.referredBy,
      p.loginCount,
      p.lastLoginAt
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
      referrals_count, referred_by, login_count, last_login_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
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
      referred_by = EXCLUDED.referred_by,
      login_count = EXCLUDED.login_count,
      last_login_at = EXCLUDED.last_login_at`,
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
      p.referredBy,
      p.loginCount,
      p.lastLoginAt
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
   BAN HELPERS
========================= */

async function isPlayerBanned(id) {
  const result = await pool.query(
    `SELECT id, reason, banned_at
     FROM banned_players
     WHERE id = $1
     LIMIT 1`,
    [id]
  );

  return result.rows[0] || null;
}

async function banPlayer(id, reason = "") {
  const safeReason = String(reason || "").trim();

  await pool.query(
    `INSERT INTO banned_players (id, reason, banned_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       reason = EXCLUDED.reason,
       banned_at = EXCLUDED.banned_at`,
    [id, safeReason, Date.now()]
  );

  return isPlayerBanned(id);
}

async function unbanPlayer(id) {
  const result = await pool.query(
    `DELETE FROM banned_players WHERE id = $1`,
    [id]
  );

  return result.rowCount > 0;
}

async function resetPlayerCoins(id) {
  const player = await getOrCreatePlayer(id);

  const updatedPlayer = {
    ...player,
    score: 0,
    lastTime: Date.now()
  };

  return savePlayer(id, updatedPlayer);
}

/* =========================
   FREEZE HELPERS
========================= */

async function getFrozenPlayer(id) {
  const result = await pool.query(
    `SELECT id, reason, frozen_until, frozen_at
     FROM frozen_players
     WHERE id = $1
     LIMIT 1`,
    [id]
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  const now = Date.now();
  const frozenUntil = Number(row.frozen_until || 0);

  if (frozenUntil <= now) {
    await pool.query(`DELETE FROM frozen_players WHERE id = $1`, [id]);
    return null;
  }

  return row;
}

async function freezePlayer(id, durationMs, reason = "") {
  const now = Date.now();
  const frozenUntil = now + Number(durationMs || 0);
  const safeReason = String(reason || "").trim();

  await pool.query(
    `INSERT INTO frozen_players (id, reason, frozen_until, frozen_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       reason = EXCLUDED.reason,
       frozen_until = EXCLUDED.frozen_until,
       frozen_at = EXCLUDED.frozen_at`,
    [id, safeReason, frozenUntil, now]
  );

  return getFrozenPlayer(id);
}

async function unfreezePlayer(id) {
  const result = await pool.query(
    `DELETE FROM frozen_players WHERE id = $1`,
    [id]
  );

  return result.rowCount > 0;
}

async function notifyExpiredFreezes() {
  try {
    const now = Date.now();

    const result = await pool.query(
      `SELECT id, reason, frozen_until
       FROM frozen_players
       WHERE frozen_until <= $1`,
      [now]
    );

    if (!result.rows.length) return;

    for (const row of result.rows) {
      const playerId = String(row.id || "").trim();
      if (!playerId) continue;

      try {
        await bot.sendMessage(
          playerId,
          `✅ Заморозка аккаунта закончилась

🎮 Теперь ты снова можешь зайти в ArTap`
        );
      } catch (notifyError) {
        console.log(`Не удалось отправить сообщение игроку ${playerId}:`, notifyError.message);
      }

      await pool.query(
        `DELETE FROM frozen_players WHERE id = $1`,
        [playerId]
      );
    }
  } catch (error) {
    console.log("Ошибка notifyExpiredFreezes:", error);
  }
}

/* =========================
   PROMO HELPERS
========================= */

async function getPromoByCode(code) {
  const normalizedCode = normalizePromoCode(code);

  const result = await pool.query(
    `SELECT code, reward, max_activations, current_activations, is_active, created_by, created_at
     FROM promo_codes
     WHERE code = $1`,
    [normalizedCode]
  );

  return result.rows[0] || null;
}

async function createPromoCode({ code, reward, maxActivations, createdBy }) {
  const normalizedCode = normalizePromoCode(code);

  await pool.query(
    `INSERT INTO promo_codes (
      code, reward, max_activations, current_activations, is_active, created_by, created_at
    ) VALUES ($1, $2, $3, 0, TRUE, $4, $5)`,
    [normalizedCode, reward, maxActivations, createdBy, Date.now()]
  );

  return getPromoByCode(normalizedCode);
}

async function getPromoList() {
  const result = await pool.query(
    `SELECT code, reward, max_activations, current_activations, is_active, created_at
     FROM promo_codes
     ORDER BY created_at DESC
     LIMIT 50`
  );

  return result.rows;
}

async function deletePromoCode(code) {
  const normalizedCode = normalizePromoCode(code);

  const result = await pool.query(
    `DELETE FROM promo_codes WHERE code = $1`,
    [normalizedCode]
  );

  return result.rowCount > 0;
}

async function activatePromoCode({ code, playerId, nickname }) {
  const normalizedCode = normalizePromoCode(code);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const promoRes = await client.query(
      `SELECT code, reward, max_activations, current_activations, is_active
       FROM promo_codes
       WHERE code = $1
       FOR UPDATE`,
      [normalizedCode]
    );

    if (!promoRes.rows.length) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }

    const promo = promoRes.rows[0];

    if (!promo.is_active) {
      await client.query("ROLLBACK");
      return { ok: false, error: "inactive" };
    }

    if (Number(promo.current_activations) >= Number(promo.max_activations)) {
      await client.query("ROLLBACK");
      return { ok: false, error: "limit_reached" };
    }

    const usedRes = await client.query(
      `SELECT 1
       FROM promo_activations
       WHERE code = $1 AND player_id = $2
       LIMIT 1`,
      [normalizedCode, playerId]
    );

    if (usedRes.rows.length) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_used" };
    }

    await client.query(
      `INSERT INTO players (id, nickname, last_time)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [playerId, nickname || "Игрок", Date.now()]
    );

    await client.query(
      `INSERT INTO promo_activations (code, player_id, activated_at)
       VALUES ($1, $2, $3)`,
      [normalizedCode, playerId, Date.now()]
    );

    await client.query(
      `UPDATE promo_codes
       SET current_activations = current_activations + 1,
           is_active = CASE
             WHEN current_activations + 1 >= max_activations THEN FALSE
             ELSE TRUE
           END
       WHERE code = $1`,
      [normalizedCode]
    );

    await client.query(
      `UPDATE players
       SET score = score + $1,
           nickname = COALESCE(NULLIF($2, ''), nickname),
           last_time = $3
       WHERE id = $4`,
      [Number(promo.reward), nickname || "Игрок", Date.now(), playerId]
    );

    await client.query("COMMIT");

    const updatedPromo = await getPromoByCode(normalizedCode);
    const updatedPlayer = await getOrCreatePlayer(playerId, { nickname });

    return {
      ok: true,
      reward: Number(promo.reward),
      promo: updatedPromo,
      player: updatedPlayer
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function handlePromoActivation(chatId, playerId, nickname, rawCode) {
  if (!rawCode) {
    return bot.sendMessage(chatId, "❌ Промокод пустой");
  }

  const banned = await isPlayerBanned(playerId);
  if (banned) {
    return bot.sendMessage(
      chatId,
      `⛔ Ты заблокирован в игре${banned.reason ? `\nПричина: ${banned.reason}` : ""}`
    );
  }

  const frozen = await getFrozenPlayer(playerId);
  if (frozen) {
    const left = formatFreezeLeft(Number(frozen.frozen_until || 0) - Date.now());
    return bot.sendMessage(
      chatId,
      `❄️ Твой аккаунт заморожен\n⏳ Осталось: ${left}${frozen.reason ? `\n📄 Причина: ${frozen.reason}` : ""}`
    );
  }

  const result = await activatePromoCode({
    code: rawCode,
    playerId,
    nickname
  });

  if (!result.ok) {
    if (result.error === "not_found") {
      return bot.sendMessage(chatId, "❌ Промокод не найден");
    }

    if (result.error === "inactive") {
      return bot.sendMessage(chatId, "❌ Этот промокод уже неактивен");
    }

    if (result.error === "limit_reached") {
      return bot.sendMessage(chatId, "❌ У этого промокода закончились активации");
    }

    if (result.error === "already_used") {
      return bot.sendMessage(chatId, "❌ Ты уже активировал этот промокод");
    }

    return bot.sendMessage(chatId, "❌ Не удалось активировать промокод");
  }

  const left = Math.max(
    0,
    Number(result.promo.max_activations || 0) - Number(result.promo.current_activations || 0)
  );

  return bot.sendMessage(
    chatId,
    `✅ Промокод активирован!\n🪙 Ты получил ${result.reward} монет\n📦 Осталось активаций: ${left}`
  );
}

/* =========================
   MAINTENANCE HELPERS
========================= */

async function getMaintenanceSettings() {
  const result = await pool.query(
    `SELECT key, value_text, value_bool
     FROM game_settings
     WHERE key = 'maintenance'
     LIMIT 1`
  );

  if (!result.rows.length) {
    return {
      enabled: false,
      text: "🔧 Сейчас идут техработы. Зайди позже."
    };
  }

  return {
    enabled: Boolean(result.rows[0].value_bool),
    text: String(result.rows[0].value_text || "🔧 Сейчас идут техработы. Зайди позже.")
  };
}

async function setMaintenanceEnabled(enabled) {
  await pool.query(
    `INSERT INTO game_settings (key, value_bool, updated_at)
     VALUES ('maintenance', $1, $2)
     ON CONFLICT (key) DO UPDATE SET
       value_bool = EXCLUDED.value_bool,
       updated_at = EXCLUDED.updated_at`,
    [Boolean(enabled), Date.now()]
  );

  return getMaintenanceSettings();
}

async function setMaintenanceText(text) {
  const safeText =
    String(text || "").trim() || "🔧 Сейчас идут техработы. Зайди позже.";

  await pool.query(
    `INSERT INTO game_settings (key, value_text, updated_at)
     VALUES ('maintenance', $1, $2)
     ON CONFLICT (key) DO UPDATE SET
       value_text = EXCLUDED.value_text,
       updated_at = EXCLUDED.updated_at`,
    [safeText, Date.now()]
  );

  return getMaintenanceSettings();
}

/* =========================
   /START + РЕФЕРАЛКА
========================= */

bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
  users.add(msg.from.id);

  const playerId = String(msg.from.id);
  const nickname = getTelegramNickname(msg.from);
  const startParam = String(match?.[1] || "").trim();

  try {
    const banned = await isPlayerBanned(playerId);
    if (banned) {
      return bot.sendMessage(
        msg.chat.id,
        `⛔ Ты заблокирован в игре${banned.reason ? `\nПричина: ${banned.reason}` : ""}`
      );
    }

    const frozen = await getFrozenPlayer(playerId);
    if (frozen) {
      const left = formatFreezeLeft(Number(frozen.frozen_until || 0) - Date.now());
      return bot.sendMessage(
        msg.chat.id,
        `❄️ Твой аккаунт в ArTap заморожен\n⏳ Осталось: ${left}${frozen.reason ? `\n📄 Причина: ${frozen.reason}` : ""}`
      );
    }

    const startedBefore = await hasBotStartedBefore(playerId);

    let player = await getPlayer(playerId);

    if (!player) {
      await createPlayer(playerId, {
        nickname,
        loginCount: 1,
        lastLoginAt: Date.now()
      });
      player = await getPlayer(playerId);
    } else {
      player = await savePlayer(playerId, {
        ...player,
        nickname,
        loginCount: Number(player.loginCount || 0) + 1,
        lastLoginAt: Date.now()
      });
    }

    await updateOnlinePlayer(playerId, nickname);

    if (!startedBefore && startParam.startsWith("ref_")) {
      const inviterId = startParam.replace("ref_", "").trim();

      if (inviterId && inviterId !== playerId && !player.referredBy) {
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

bot.onText(/^\/ref$/, async (msg) => {
  try {
    const playerId = String(msg.from.id);

    const banned = await isPlayerBanned(playerId);
    if (banned) {
      return bot.sendMessage(
        msg.chat.id,
        `⛔ Ты заблокирован в игре${banned.reason ? `\nПричина: ${banned.reason}` : ""}`
      );
    }

    const frozen = await getFrozenPlayer(playerId);
    if (frozen) {
      const left = formatFreezeLeft(Number(frozen.frozen_until || 0) - Date.now());
      return bot.sendMessage(
        msg.chat.id,
        `❄️ Твой аккаунт заморожен\n⏳ Осталось: ${left}${frozen.reason ? `\n📄 Причина: ${frozen.reason}` : ""}`
      );
    }

    const me = await bot.getMe();

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

bot.onText(/^\/promo$/, async (msg) => {
  try {
    const playerId = String(msg.from.id);
    const nickname = getTelegramNickname(msg.from);

    const banned = await isPlayerBanned(playerId);
    if (banned) {
      return bot.sendMessage(
        msg.chat.id,
        `⛔ Ты заблокирован в игре${banned.reason ? `\nПричина: ${banned.reason}` : ""}`
      );
    }

    const frozen = await getFrozenPlayer(playerId);
    if (frozen) {
      const left = formatFreezeLeft(Number(frozen.frozen_until || 0) - Date.now());
      return bot.sendMessage(
        msg.chat.id,
        `❄️ Твой аккаунт заморожен\n⏳ Осталось: ${left}${frozen.reason ? `\n📄 Причина: ${frozen.reason}` : ""}`
      );
    }

    await updateOnlinePlayer(playerId, nickname);

    promoInputState.set(playerId, {
      action: "promo_activate"
    });

    await bot.sendMessage(msg.chat.id, "🎟 Напиши промокод");
  } catch (error) {
    console.log("Ошибка /promo:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка");
  }
});

bot.onText(/^\/players$/, (msg) => {
  if (msg.from.id === adminId) {
    bot.sendMessage(msg.chat.id, "👥 Игроков: " + users.size);
  }
});

bot.onText(/^\/online$/, async (msg) => {
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

bot.onText(/^\/admin$/, (msg) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  bot.sendMessage(
    msg.chat.id,
`⚙️ Админ команды ArTap

/give ID СУММА ТЕКСТ
➜ Выдать монеты игроку

/take ID СУММА ТЕКСТ
➜ Забрать монеты у игрока

/profile ID
➜ Посмотреть профиль игрока

/logins ID
➜ Сколько раз игрок заходил

/lastlogin ID
➜ Последний вход игрока

/promohistory ID
➜ История промокодов игрока

/deleteplayer ID ТЕКСТ
➜ Полностью удалить игрока

/ban ID ПРИЧИНА
➜ Забанить игрока

/unban ID
➜ Разбанить игрока

/freeze ID ВРЕМЯ ПРИЧИНА
➜ Заморозить игрока

/unfreeze ID
➜ Снять заморозку

/resetcoins ID
➜ Сбросить монеты игроку

/broadcast ТЕКСТ
➜ Отправить сообщение всем игрокам

/createpromo
➜ Создать промокод через вопросы

/cancelpromo
➜ Отменить создание промокода

/promoinfo
➜ Проверка промокода по шагам

/promolist
➜ Список промокодов

/promodelete
➜ Удалить промокод по шагам

/promo
➜ Игрок вводит промокод по шагам

/maintenance on
➜ Включить техработы

/maintenance off
➜ Выключить техработы

/maintenance status
➜ Проверить статус техработ

/maintenancetext
➜ Изменить текст техработ

/players
➜ Посмотреть количество игроков

/online
➜ Кто сейчас в игре`
  );
});

bot.onText(/^\/logins\s+(\S+)$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1] || "").trim();
    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    const player = await getOrCreatePlayer(playerId);

    await bot.sendMessage(
      msg.chat.id,
      `👤 Игрок: ${playerId}\n📊 Заходил в игру: ${player.loginCount || 0} раз`
    );
  } catch (error) {
    console.log("Ошибка /logins:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при получении входов");
  }
});

bot.onText(/^\/lastlogin\s+(\S+)$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1] || "").trim();
    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    const player = await getOrCreatePlayer(playerId);

    await bot.sendMessage(
      msg.chat.id,
      `👤 Игрок: ${playerId}\n🕒 Последний вход: ${formatDateTime(player.lastLoginAt)}`
    );
  } catch (error) {
    console.log("Ошибка /lastlogin:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при получении последнего входа");
  }
});

bot.onText(/^\/promohistory\s+(\S+)$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1] || "").trim();
    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    const result = await pool.query(
      `SELECT code, activated_at
       FROM promo_activations
       WHERE player_id = $1
       ORDER BY activated_at DESC
       LIMIT 30`,
      [playerId]
    );

    if (!result.rows.length) {
      return bot.sendMessage(
        msg.chat.id,
        `🎟 Игрок ${playerId} ещё не активировал промокоды`
      );
    }

    const text = result.rows
      .map((row, index) => {
        return `${index + 1}. ${row.code} — ${formatDateTime(row.activated_at)}`;
      })
      .join("\n");

    await bot.sendMessage(
      msg.chat.id,
      `🎟 История промокодов игрока ${playerId}:\n\n${text}`
    );
  } catch (error) {
    console.log("Ошибка /promohistory:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при получении истории промокодов");
  }
});

bot.onText(/^\/createpromo$/, async (msg) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  promoCreationState.set(String(msg.from.id), {
    step: "code"
  });

  await bot.sendMessage(
    msg.chat.id,
    "🎟 Создание промокода\n\nНапиши код промокода.\nПример: ARTAP"
  );
});

bot.onText(/^\/cancelpromo$/, async (msg) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  promoCreationState.delete(String(msg.from.id));
  await bot.sendMessage(msg.chat.id, "❌ Создание промокода отменено");
});

bot.onText(/^\/promoinfo$/, async (msg) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  promoInputState.set(String(msg.from.id), {
    action: "promo_info"
  });

  await bot.sendMessage(
    msg.chat.id,
    "📋 Напиши код промокода для проверки"
  );
});

bot.onText(/^\/promolist$/, async (msg) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const promos = await getPromoList();

    if (!promos.length) {
      return bot.sendMessage(msg.chat.id, "📭 Промокодов пока нет");
    }

    const text = promos
      .map((promo, index) => {
        const left = Math.max(
          0,
          Number(promo.max_activations || 0) - Number(promo.current_activations || 0)
        );
        const status = promo.is_active ? "✅" : "❌";
        return `${index + 1}. ${promo.code} — ${promo.reward} 🪙 — ${promo.current_activations}/${promo.max_activations} — осталось ${left} ${status}`;
      })
      .join("\n");

    await bot.sendMessage(
      msg.chat.id,
      `🎟 Список промокодов:\n\n${text}`
    );
  } catch (error) {
    console.log("Ошибка /promolist:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при получении списка промокодов");
  }
});

bot.onText(/^\/promodelete$/, async (msg) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  promoInputState.set(String(msg.from.id), {
    action: "promo_delete"
  });

  await bot.sendMessage(
    msg.chat.id,
    "🗑 Напиши код промокода для удаления"
  );
});

bot.onText(/^\/maintenance(?:\s+(on|off|status))?$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const action = String(match?.[1] || "status").toLowerCase();

    if (action === "on") {
      const settings = await setMaintenanceEnabled(true);
      return bot.sendMessage(
        msg.chat.id,
        `🔒 Техработы включены\n\nТекст:\n${settings.text}`
      );
    }

    if (action === "off") {
      await setMaintenanceEnabled(false);
      return bot.sendMessage(msg.chat.id, "✅ Игра снова открыта");
    }

    const settings = await getMaintenanceSettings();
    return bot.sendMessage(
      msg.chat.id,
      `📋 Статус техработ: ${settings.enabled ? "ВКЛЮЧЕНЫ" : "ВЫКЛЮЧЕНЫ"}\n\nТекст:\n${settings.text}`
    );
  } catch (error) {
    console.log("Ошибка /maintenance:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка команды техработ");
  }
});

bot.onText(/^\/maintenancetext$/i, async (msg) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  maintenanceInputState.set(String(msg.from.id), {
    action: "maintenance_text"
  });

  await bot.sendMessage(
    msg.chat.id,
    "📝 Напиши новый текст для техработ"
  );
});

bot.onText(/^\/ban\s+(\S+)(?:\s+([\s\S]+))?$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1] || "").trim();
    const reason = String(match[2] || "").trim();

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    if (playerId === String(adminId)) {
      return bot.sendMessage(msg.chat.id, "❌ Себя забанить нельзя");
    }

    const banned = await banPlayer(playerId, reason);

    await pool.query("DELETE FROM online_players WHERE id = $1", [playerId]);

    await bot.sendMessage(
      msg.chat.id,
      `🚫 Игрок ${playerId} забанен${banned?.reason ? `\nПричина: ${banned.reason}` : ""}`
    );

    try {
      await bot.sendMessage(
        playerId,
        `🚫 Ты заблокирован в ArTap${banned?.reason ? `\nПричина: ${banned.reason}` : ""}`
      );
    } catch (notifyError) {
      console.log("Не удалось уведомить игрока о бане:", notifyError.message);
    }
  } catch (error) {
    console.log("Ошибка /ban:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при бане игрока");
  }
});

bot.onText(/^\/unban\s+(\S+)$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1] || "").trim();

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    const unbanned = await unbanPlayer(playerId);

    if (!unbanned) {
      return bot.sendMessage(msg.chat.id, "❌ Этот игрок не забанен");
    }

    await bot.sendMessage(
      msg.chat.id,
      `✅ Игрок ${playerId} разбанен`
    );

    try {
      await bot.sendMessage(
        playerId,
        "✅ Ты разбанен в ArTap"
      );
    } catch (notifyError) {
      console.log("Не удалось уведомить игрока о разбане:", notifyError.message);
    }
  } catch (error) {
    console.log("Ошибка /unban:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при разбане игрока");
  }
});

bot.onText(/^\/freeze\s+(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1] || "").trim();
    const durationText = String(match[2] || "").trim();
    const reason = String(match[3] || "").trim();

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    if (playerId === String(adminId)) {
      return bot.sendMessage(msg.chat.id, "❌ Себя заморозить нельзя");
    }

    const durationMs = parseFreezeDuration(durationText);

    if (!durationMs) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ Неверное время\nПримеры:\n/freeze 123456789 5m причина\n/freeze 123456789 2h причина\n/freeze 123456789 1d причина"
      );
    }

    const frozen = await freezePlayer(playerId, durationMs, reason);

    await pool.query("DELETE FROM online_players WHERE id = $1", [playerId]);

    const leftText = formatFreezeLeft(Number(frozen.frozen_until || 0) - Date.now());

    await bot.sendMessage(
      msg.chat.id,
      `❄️ Игрок ${playerId} заморожен\n⏳ Срок: ${leftText}${reason ? `\n📄 Причина: ${reason}` : ""}`
    );

    try {
      await bot.sendMessage(
        playerId,
        `❄️ Твой аккаунт в ArTap заморожен\n⏳ Срок: ${leftText}${reason ? `\n📄 Причина: ${reason}` : ""}`
      );
    } catch (notifyError) {
      console.log("Не удалось уведомить игрока о заморозке:", notifyError.message);
    }
  } catch (error) {
    console.log("Ошибка /freeze:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при заморозке игрока");
  }
});

bot.onText(/^\/unfreeze\s+(\S+)$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1] || "").trim();

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    const unfrozen = await unfreezePlayer(playerId);

    if (!unfrozen) {
      return bot.sendMessage(msg.chat.id, "❌ Этот игрок не заморожен");
    }

    await bot.sendMessage(
      msg.chat.id,
      `✅ Игрок ${playerId} разморожен`
    );

    try {
      await bot.sendMessage(
        playerId,
        "✅ Заморозка аккаунта снята\n🎮 Доступ к ArTap снова открыт"
      );
    } catch (notifyError) {
      console.log("Не удалось уведомить игрока о разморозке:", notifyError.message);
    }
  } catch (error) {
    console.log("Ошибка /unfreeze:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при разморозке игрока");
  }
});

bot.onText(/^\/resetcoins\s+(\S+)$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1] || "").trim();

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    const savedPlayer = await resetPlayerCoins(playerId);

    await bot.sendMessage(
      msg.chat.id,
      `🧹 Монеты игрока ${playerId} сброшены\n💰 Теперь у него: ${savedPlayer.score} монет`
    );

    try {
      if (String(msg.chat.id) !== playerId) {
        await bot.sendMessage(
          playerId,
          "🧹 Твои монеты в ArTap были сброшены админом"
        );
      }
    } catch (notifyError) {
      console.log("Не удалось уведомить игрока о сбросе монет:", notifyError.message);
    }
  } catch (error) {
    console.log("Ошибка /resetcoins:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при сбросе монет");
  }
});

bot.onText(/^\/broadcast\s+([\s\S]+)$/i, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const messageText = String(match[1] || "").trim();

    if (!messageText) {
      return bot.sendMessage(msg.chat.id, "❌ Напиши текст для рассылки");
    }

    const result = await pool.query(
      `SELECT id FROM bot_users ORDER BY first_started_at ASC`
    );

    const allUsers = result.rows
      .map((row) => String(row.id || "").trim())
      .filter(Boolean);

    if (!allUsers.length) {
      return bot.sendMessage(msg.chat.id, "❌ Нет игроков для рассылки");
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;

    await bot.sendMessage(
      msg.chat.id,
      `📢 Начинаю рассылку...\n👥 Всего игроков: ${allUsers.length}`
    );

    for (const userId of allUsers) {
      try {
        const banned = await isPlayerBanned(userId);
        if (banned) {
          skipped++;
          continue;
        }

        const frozen = await getFrozenPlayer(userId);
        if (frozen) {
          skipped++;
          continue;
        }

        await bot.sendMessage(
          userId,
          `📢 Сообщение от администрации ArTap\n\n${messageText}`
        );

        success++;
      } catch (error) {
        failed++;
        console.log(`Ошибка рассылки игроку ${userId}:`, error.message);
      }

      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    await bot.sendMessage(
      msg.chat.id,
      `✅ Рассылка завершена\n\n📨 Успешно: ${success}\n⏭ Пропущено: ${skipped}\n❌ Ошибок: ${failed}`
    );
  } catch (error) {
    console.log("Ошибка /broadcast:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при рассылке");
  }
});

bot.onText(/^\/give\s+(\S+)\s+(\d+)(?:\s+([\s\S]+))?$/, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1]).trim();
    const amount = Math.floor(Number(match[2]));
    const extraText = String(match[3] || "").trim();

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(msg.chat.id, "❌ Неверная сумма");
    }

    const banned = await isPlayerBanned(playerId);
    if (banned) {
      return bot.sendMessage(msg.chat.id, "❌ Игрок забанен");
    }

    const frozen = await getFrozenPlayer(playerId);
    if (frozen) {
      return bot.sendMessage(msg.chat.id, "❌ Игрок заморожен");
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
      `✅ Игроку ${playerId} начислено ${amount} монет` +
      `${extraText ? `\n💬 ${extraText}` : ""}` +
      `\n💰 Теперь у него: ${savedPlayer.score} монет`
    );

    try {
      if (String(msg.chat.id) !== playerId) {
        await bot.sendMessage(
          playerId,
          `🎁 Вам начислено ${amount} монет в ArTap!` +
          `${extraText ? `\n💬 ${extraText}` : ""}`
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

bot.onText(/^\/take\s+(\S+)\s+(\d+)(?:\s+([\s\S]+))?$/, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1]).trim();
    const amount = Math.floor(Number(match[2]));
    const extraText = String(match[3] || "").trim();

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
      `➖ У игрока ${playerId} снято ${removed} монет` +
      `${extraText ? `\n💬 ${extraText}` : ""}` +
      `\n💰 Теперь у него: ${savedPlayer.score} монет`
    );

    try {
      if (String(msg.chat.id) !== playerId) {
        await bot.sendMessage(
          playerId,
          `➖ У вас снято ${removed} монет в ArTap` +
          `${extraText ? `\n💬 ${extraText}` : ""}`
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

bot.onText(/^\/profile\s+(\S+)$/, async (msg, match) => {
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
    const banned = await isPlayerBanned(playerId);
    const frozen = await getFrozenPlayer(playerId);

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
📊 Входов: ${player.loginCount || 0}
🕒 Последний вход: ${formatDateTime(player.lastLoginAt)}
🚫 Бан: ${banned ? "Да" : "Нет"}${banned?.reason ? `\n📄 Причина бана: ${banned.reason}` : ""}
❄️ Заморозка: ${frozen ? "Да" : "Нет"}${frozen ? `\n⏳ До: ${formatDateTime(frozen.frozen_until)}${frozen.reason ? `\n📄 Причина: ${frozen.reason}` : ""}` : ""}

🏆 Достижения:
${achievementsText}`
    );
  } catch (error) {
    console.log("Ошибка /profile:", error);
    bot.sendMessage(msg.chat.id, "❌ Ошибка при просмотре профиля");
  }
});

bot.onText(/^\/deleteplayer\s+(\S+)(?:\s+([\s\S]+))?$/, async (msg, match) => {
  if (msg.from.id !== adminId) {
    return bot.sendMessage(msg.chat.id, "⛔ Нет доступа");
  }

  try {
    const playerId = String(match[1]).trim();
    const extraText = String(match[2] || "").trim();

    if (!playerId) {
      return bot.sendMessage(msg.chat.id, "❌ Укажи ID игрока");
    }

    const deleted = await deletePlayer(playerId);

    if (!deleted) {
      return bot.sendMessage(msg.chat.id, `❌ Игрок ${playerId} не найден`);
    }

    users.delete(Number(playerId));
    await pool.query("DELETE FROM online_players WHERE id = $1", [playerId]);
    await pool.query("DELETE FROM frozen_players WHERE id = $1", [playerId]);

    await bot.sendMessage(
      msg.chat.id,
      `🗑 Игрок ${playerId} полностью удалён из игры` +
      `${extraText ? `\n💬 ${extraText}` : ""}`
    );

    try {
      if (String(msg.chat.id) !== playerId) {
        await bot.sendMessage(
          playerId,
          `🗑 Ваш профиль удалён из ArTap` +
          `${extraText ? `\n💬 ${extraText}` : ""}`
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
   MESSAGE HANDLER
========================= */

bot.on("message", async (msg) => {
  try {
    if (!msg.text) return;

    const text = String(msg.text).trim();
    const playerId = String(msg.from.id);
    const nickname = getTelegramNickname(msg.from);

    if (!text || text.startsWith("/")) {
      return;
    }

    const maintenanceState = maintenanceInputState.get(playerId);

    if (maintenanceState && maintenanceState.action === "maintenance_text") {
      if (msg.from.id !== adminId) {
        maintenanceInputState.delete(playerId);
        return;
      }

      maintenanceInputState.delete(playerId);

      const settings = await setMaintenanceText(text);

      return bot.sendMessage(
        msg.chat.id,
        `✅ Текст техработ обновлён\n\nНовый текст:\n${settings.text}`
      );
    }

    const promoWait = promoInputState.get(playerId);

    if (promoWait && promoWait.action === "promo_activate") {
      promoInputState.delete(playerId);
      await updateOnlinePlayer(playerId, nickname);
      return handlePromoActivation(msg.chat.id, playerId, nickname, text);
    }

    if (promoWait && promoWait.action === "promo_info") {
      if (msg.from.id !== adminId) {
        promoInputState.delete(playerId);
        return;
      }

      promoInputState.delete(playerId);

      const code = normalizePromoCode(text);
      const promo = await getPromoByCode(code);

      if (!promo) {
        return bot.sendMessage(msg.chat.id, "❌ Промокод не найден");
      }

      const left = Math.max(
        0,
        Number(promo.max_activations || 0) - Number(promo.current_activations || 0)
      );

      const status = promo.is_active ? "активен" : (left === 0 ? "закончился" : "выключен");

      return bot.sendMessage(
        msg.chat.id,
        `🎟 Промокод: ${promo.code}\n🪙 Награда: ${promo.reward}\n✅ Активировано: ${promo.current_activations}\n📦 Осталось: ${left}\n📊 Всего активаций: ${promo.max_activations}\nСтатус: ${status}`
      );
    }

    if (promoWait && promoWait.action === "promo_delete") {
      if (msg.from.id !== adminId) {
        promoInputState.delete(playerId);
        return;
      }

      promoInputState.delete(playerId);

      const code = normalizePromoCode(text);
      const deleted = await deletePromoCode(code);

      if (!deleted) {
        return bot.sendMessage(msg.chat.id, "❌ Промокод не найден");
      }

      await pool.query(
        `DELETE FROM promo_activations WHERE code = $1`,
        [code]
      );

      return bot.sendMessage(
        msg.chat.id,
        `🗑 Промокод ${code} удалён`
      );
    }

    if (msg.from.id !== adminId) return;

    const adminKey = String(msg.from.id);
    const state = promoCreationState.get(adminKey);
    if (!state) return;

    if (state.step === "code") {
      const code = normalizePromoCode(text);

      if (!code) {
        return bot.sendMessage(msg.chat.id, "❌ Код не может быть пустым. Напиши код ещё раз.");
      }

      if (code.length < 3) {
        return bot.sendMessage(msg.chat.id, "❌ Код слишком короткий. Минимум 3 символа.");
      }

      const existingPromo = await getPromoByCode(code);
      if (existingPromo) {
        return bot.sendMessage(msg.chat.id, "❌ Такой промокод уже существует. Напиши другой код.");
      }

      promoCreationState.set(adminKey, {
        step: "reward",
        code
      });

      return bot.sendMessage(
        msg.chat.id,
        `✅ Код: ${code}\n\nТеперь напиши, сколько монет выдавать.`
      );
    }

    if (state.step === "reward") {
      const reward = Math.floor(Number(text));

      if (!Number.isFinite(reward) || reward <= 0) {
        return bot.sendMessage(msg.chat.id, "❌ Награда должна быть числом больше 0. Напиши сумму ещё раз.");
      }

      promoCreationState.set(adminKey, {
        ...state,
        step: "max_activations",
        reward
      });

      return bot.sendMessage(
        msg.chat.id,
        `✅ Награда: ${reward} монет\n\nТеперь напиши количество активаций.`
      );
    }

    if (state.step === "max_activations") {
      const maxActivations = Math.floor(Number(text));

      if (!Number.isFinite(maxActivations) || maxActivations <= 0) {
        return bot.sendMessage(msg.chat.id, "❌ Количество активаций должно быть числом больше 0.");
      }

      const promo = await createPromoCode({
        code: state.code,
        reward: state.reward,
        maxActivations,
        createdBy: adminKey
      });

      promoCreationState.delete(adminKey);

      return bot.sendMessage(
        msg.chat.id,
        `✅ Промокод создан!\n\n🎟 Код: ${promo.code}\n🪙 Награда: ${promo.reward}\n📦 Активаций: ${promo.max_activations}`
      );
    }
  } catch (error) {
    console.log("Ошибка message handler:", error);
    if (msg?.from?.id === adminId) {
      promoCreationState.delete(String(msg.from.id));
      maintenanceInputState.delete(String(msg.from.id));
    }
    promoInputState.delete(String(msg?.from?.id || ""));
    bot.sendMessage(msg.chat.id, "❌ Ошибка");
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

    const banned = await isPlayerBanned(id);
    if (banned) {
      return res.status(403).json({
        error: "Игрок забанен",
        banned: true,
        reason: banned.reason || ""
      });
    }

    const frozen = await getFrozenPlayer(id);
    if (frozen) {
      return res.status(423).json({
        error: "Игрок заморожен",
        frozen: true,
        reason: frozen.reason || "",
        frozenUntil: Number(frozen.frozen_until || 0),
        leftText: formatFreezeLeft(Number(frozen.frozen_until || 0) - Date.now())
      });
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

    const banned = await isPlayerBanned(id);
    if (banned) {
      return res.status(403).json({
        error: "Игрок забанен",
        banned: true,
        reason: banned.reason || ""
      });
    }

    const frozen = await getFrozenPlayer(id);
    if (frozen) {
      return res.status(423).json({
        error: "Игрок заморожен",
        frozen: true,
        reason: frozen.reason || "",
        frozenUntil: Number(frozen.frozen_until || 0),
        leftText: formatFreezeLeft(Number(frozen.frozen_until || 0) - Date.now())
      });
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
      loginCount: oldPlayer.loginCount,
      lastLoginAt: oldPlayer.lastLoginAt,
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

    const banned = await isPlayerBanned(id);
    if (banned) {
      return res.status(403).json({
        error: "Игрок забанен",
        banned: true,
        reason: banned.reason || ""
      });
    }

    const frozen = await getFrozenPlayer(id);
    if (frozen) {
      return res.status(423).json({
        error: "Игрок заморожен",
        frozen: true,
        reason: frozen.reason || "",
        frozenUntil: Number(frozen.frozen_until || 0),
        leftText: formatFreezeLeft(Number(frozen.frozen_until || 0) - Date.now())
      });
    }

    await updateOnlinePlayer(id, nickname);

    return res.json({ status: "ok" });
  } catch (error) {
    console.log("Ошибка /online:", error);
    return res.status(500).json({ error: "Ошибка онлайна" });
  }
});

app.get("/game-status", async (req, res) => {
  try {
    const settings = await getMaintenanceSettings();

    return res.json({
      maintenance: settings.enabled,
      text: settings.text
    });
  } catch (error) {
    console.log("Ошибка /game-status:", error);
    return res.status(500).json({
      error: "Ошибка статуса игры"
    });
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
  const indexPath = path.join(__dirname, "index.html");

  res.sendFile(indexPath, (err) => {
    if (err) {
      console.log("Ошибка загрузки index.html:", err.message);
      res.status(500).send("Ошибка загрузки игры");
    }
  });
});

/* =========================
   INACTIVE PLAYER REMINDER
========================= */

async function remindInactivePlayers() {
  try {
    const result = await pool.query(`
      SELECT id, nickname, last_time
      FROM players
    `);

    const now = Date.now();

    for (const row of result.rows) {
      const playerId = String(row.id || "").trim();
      const lastTime = Number(row.last_time || 0);

      if (!playerId || !lastTime) continue;

      const banned = await isPlayerBanned(playerId);
      if (banned) continue;

      const frozen = await getFrozenPlayer(playerId);
      if (frozen) continue;

      const diff = now - lastTime;

      if (diff < REMIND_AFTER_MS) {
        remindedPlayers.delete(playerId);
        continue;
      }

      const lastRemindedAt = remindedPlayers.get(playerId) || 0;

      if (now - lastRemindedAt < REMIND_REPEAT_MS) {
        continue;
      }

      try {
        await bot.sendMessage(
          playerId,
`⚡ Энергия восстановилась!

🎮 Возвращайся в *ArTap*
и продолжай зарабатывать монеты!`,
          { parse_mode: "Markdown" }
        );

        remindedPlayers.set(playerId, now);

        console.log("Напоминание отправлено:", playerId);
      } catch (err) {
        console.log("Ошибка отправки:", playerId, err.message);
      }
    }
  } catch (error) {
    console.log("Ошибка напоминаний:", error);
  }
}

setTimeout(remindInactivePlayers, 10000);
setInterval(remindInactivePlayers, REMIND_CHECK_MS);
setInterval(notifyExpiredFreezes, FREEZE_CHECK_MS);

/* =========================
   START SERVER
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
