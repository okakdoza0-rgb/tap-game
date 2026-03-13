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
  if (player.taskAllUpgradesDone) achievements.push("✅ Купил все улучшения");

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
    console.log("Ошибка создания игрока:", error);
  }

  bot.sendMessage(
    msg.chat.id,
`🎮 Добро пожаловать в *ArTap!*

👆 Тапай по Artemwe  
🪙 Зарабатывай монеты  
⚡ Прокачивай силу клика  
🏆 Стань лучшим игроком  

🚀 Начни играть прямо сейчас!`,
{ parse_mode:"Markdown" }
  );
});

bot.onText(/\/players/, (msg)=>{
  if(msg.from.id === adminId){
    bot.sendMessage(msg.chat.id,"👥 Игроков: "+users.size);
  }
});

/* =========================
   ADMIN GIVE COINS
========================= */

bot.onText(/\/give\s+(\S+)\s+(\d+)/, async (msg,match)=>{

  if(msg.from.id !== adminId){
    return bot.sendMessage(msg.chat.id,"⛔ Нет доступа");
  }

  const id = String(match[1]);
  const amount = Number(match[2]);

  const player = await getOrCreatePlayer(id);

  player.score += amount;

  const saved = await savePlayer(id,player);

  bot.sendMessage(msg.chat.id,
`✅ Начислено ${amount}
💰 Теперь: ${saved.score}`);
});

/* =========================
   REMOVE COINS
========================= */

bot.onText(/\/take\s+(\S+)\s+(\d+)/, async (msg,match)=>{

  if(msg.from.id !== adminId){
    return bot.sendMessage(msg.chat.id,"⛔ Нет доступа");
  }

  const id = String(match[1]);
  const amount = Number(match[2]);

  const player = await getOrCreatePlayer(id);

  player.score = Math.max(0,player.score-amount);

  const saved = await savePlayer(id,player);

  bot.sendMessage(msg.chat.id,
`➖ Снято ${amount}
💰 Теперь: ${saved.score}`);
});

/* =========================
   DELETE PLAYER
========================= */

bot.onText(/\/deleteplayer\s+(\S+)/, async (msg,match)=>{

  if(msg.from.id !== adminId){
    return bot.sendMessage(msg.chat.id,"⛔ Нет доступа");
  }

  const id = String(match[1]);

  const result = await pool.query(
    "DELETE FROM players WHERE id=$1",[id]
  );

  if(result.rowCount===0){
    return bot.sendMessage(msg.chat.id,"❌ Игрок не найден");
  }

  users.delete(Number(id));

  bot.sendMessage(msg.chat.id,"🗑 Игрок удалён");
});

/* =========================
   PROFILE
========================= */

bot.onText(/\/profile\s+(\S+)/, async (msg,match)=>{

  if(msg.from.id!==adminId){
    return bot.sendMessage(msg.chat.id,"⛔ Нет доступа");
  }

  const id = String(match[1]);

  const player = await getOrCreatePlayer(id);

  const achievements = getAchievementsText(player);

  bot.sendMessage(msg.chat.id,
`👤 Профиль

🆔 ${id}
📛 ${player.nickname}

🪙 ${player.score}
⚡ ${player.clickPower}
🔋 ${player.energy}/${player.maxEnergy}

🏆 Достижения
${achievements}`);
});

/* =========================
   DATABASE
========================= */

const pool = new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:{ rejectUnauthorized:false }
});

const DEFAULT_PLAYER = {

  score:0,
  clickPower:1,

  boughtClick:false,
  boughtSpeed:false,

  incomeSeconds:5,

  fastEnergy:false,
  energyDelay:3000,

  currentSkin:"FA9BC995-07D9-4B53-AB69-3AD0DAD933B8.png",

  maxEnergy:500,
  energy:500,

  energyUpgradeCount:0,

  task10kDone:false,
  taskBuy1UpgradeDone:false,
  taskEmptyEnergyDone:false,
  task5000EnergyDone:false,
  taskAllUpgradesDone:false,

  energyWasZero:false,

  lastTime:Date.now(),

  nickname:"Игрок"
};

function normalizePlayer(player={}){

  const p={...DEFAULT_PLAYER,...player};

  p.score=Number(p.score)||0;
  p.clickPower=Number(p.clickPower)||1;
  p.maxEnergy=Number(p.maxEnergy)||500;
  p.energy=Number(p.energy)||p.maxEnergy;

  p.nickname = String(p.nickname||"Игрок");

  return p;
}

async function initDb(){

await pool.query(`
CREATE TABLE IF NOT EXISTS players(

id TEXT PRIMARY KEY,

score INTEGER DEFAULT 0,

click_power INTEGER DEFAULT 1,

bought_click BOOLEAN DEFAULT FALSE,
bought_speed BOOLEAN DEFAULT FALSE,

income_seconds INTEGER DEFAULT 5,

fast_energy BOOLEAN DEFAULT FALSE,
energy_delay INTEGER DEFAULT 3000,

current_skin TEXT,

max_energy INTEGER DEFAULT 500,
energy INTEGER DEFAULT 500,

energy_upgrade_count INTEGER DEFAULT 0,

task10k_done BOOLEAN DEFAULT FALSE,
task_buy1upgrade_done BOOLEAN DEFAULT FALSE,
task_empty_energy_done BOOLEAN DEFAULT FALSE,
task5000energy_done BOOLEAN DEFAULT FALSE,
task_all_upgrades_done BOOLEAN DEFAULT FALSE,

energy_was_zero BOOLEAN DEFAULT FALSE,

last_time BIGINT,

nickname TEXT DEFAULT 'Игрок'
)
`);

}

function rowToPlayer(r){

return{

score:r.score,
clickPower:r.click_power,

boughtClick:r.bought_click,
boughtSpeed:r.bought_speed,

incomeSeconds:r.income_seconds,

fastEnergy:r.fast_energy,
energyDelay:r.energy_delay,

currentSkin:r.current_skin,

maxEnergy:r.max_energy,
energy:r.energy,

energyUpgradeCount:r.energy_upgrade_count,

task10kDone:r.task10k_done,
taskBuy1UpgradeDone:r.task_buy1upgrade_done,
taskEmptyEnergyDone:r.task_empty_energy_done,
task5000EnergyDone:r.task5000energy_done,
taskAllUpgradesDone:r.task_all_upgrades_done,

energyWasZero:r.energy_was_zero,

lastTime:Number(r.last_time),

nickname:r.nickname
};

}

async function getPlayer(id){

const res = await pool.query(
"SELECT * FROM players WHERE id=$1",[id]
);

if(res.rows.length===0) return null;

return rowToPlayer(res.rows[0]);

}

async function createPlayer(id,extra={}){

const p={...DEFAULT_PLAYER,...extra};

await pool.query(`
INSERT INTO players(
id,score,click_power,
bought_click,bought_speed,
income_seconds,
fast_energy,energy_delay,
current_skin,
max_energy,energy,
energy_upgrade_count,
task10k_done,
task_buy1upgrade_done,
task_empty_energy_done,
task5000energy_done,
task_all_upgrades_done,
energy_was_zero,
last_time,
nickname
)
VALUES(
$1,$2,$3,
$4,$5,
$6,
$7,$8,
$9,
$10,$11,
$12,
$13,$14,$15,$16,$17,$18,$19,$20
)
ON CONFLICT(id) DO NOTHING
`,[
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
p.taskAllUpgradesDone,
p.energyWasZero,
p.lastTime,
p.nickname
]);

}

async function getOrCreatePlayer(id,extra={}){

let player = await getPlayer(id);

if(!player){

await createPlayer(id,extra);

player = await getPlayer(id);

}

return normalizePlayer({...player,...extra});

}

async function savePlayer(id,data){

const p = normalizePlayer(data);

await pool.query(`
INSERT INTO players(
id,score,click_power,
bought_click,bought_speed,
income_seconds,
fast_energy,energy_delay,
current_skin,
max_energy,energy,
energy_upgrade_count,
task10k_done,
task_buy1upgrade_done,
task_empty_energy_done,
task5000energy_done,
task_all_upgrades_done,
energy_was_zero,
last_time,
nickname
)
VALUES(
$1,$2,$3,
$4,$5,
$6,
$7,$8,
$9,
$10,$11,
$12,
$13,$14,$15,$16,$17,$18,$19,$20
)
ON CONFLICT(id)
DO UPDATE SET

score=EXCLUDED.score,
click_power=EXCLUDED.click_power,
bought_click=EXCLUDED.bought_click,
bought_speed=EXCLUDED.bought_speed,
income_seconds=EXCLUDED.income_seconds,
fast_energy=EXCLUDED.fast_energy,
energy_delay=EXCLUDED.energy_delay,
current_skin=EXCLUDED.current_skin,
max_energy=EXCLUDED.max_energy,
energy=EXCLUDED.energy,
energy_upgrade_count=EXCLUDED.energy_upgrade_count,
task10k_done=EXCLUDED.task10k_done,
task_buy1upgrade_done=EXCLUDED.task_buy1upgrade_done,
task_empty_energy_done=EXCLUDED.task_empty_energy_done,
task5000energy_done=EXCLUDED.task5000energy_done,
task_all_upgrades_done=EXCLUDED.task_all_upgrades_done,
energy_was_zero=EXCLUDED.energy_was_zero,
last_time=EXCLUDED.last_time,
nickname=EXCLUDED.nickname
`,[
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
p.taskAllUpgradesDone,
p.energyWasZero,
Date.now(),
p.nickname
]);

return getOrCreatePlayer(id);

}

/* =========================
   API
========================= */

app.get("/load/:id", async(req,res)=>{

const id = String(req.params.id);

const player = await getOrCreatePlayer(id);

res.json(player);

});

app.post("/save/:id", async(req,res)=>{

const id = String(req.params.id);

const oldPlayer = await getOrCreatePlayer(id);

const newData = req.body || {};

const merged = {...oldPlayer,...newData};

const saved = await savePlayer(id,merged);

res.json({status:"ok",player:saved});

});

/* =========================
   TOP PLAYERS
========================= */

app.get("/top", async(req,res)=>{

const result = await pool.query(`
SELECT id,nickname,score
FROM players
ORDER BY score DESC
LIMIT 50
`);

const top = result.rows.map((r,i)=>({

place:i+1,
id:r.id,
nickname:r.nickname,
score:r.score

}));

res.json(top);

});

/* =========================
   START SERVER
========================= */

initDb().then(()=>{

app.listen(PORT,()=>{

console.log("Server started on "+PORT);

});

});
