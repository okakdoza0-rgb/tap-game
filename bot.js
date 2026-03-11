const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// список игроков
let users = new Set();

// твой Telegram ID (замени на свой)
const adminId = 7837011810;

// команда /start
bot.onText(/\/start/, (msg) => {

  // сохраняем игрока
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

// команда чтобы узнать игроков
bot.onText(/\/players/, (msg) => {
  if (msg.from.id === adminId) {
    bot.sendMessage(msg.chat.id, "👥 Игроков: " + users.size);
  }
});

// сервер для Render (чтобы Render не выключал бота)
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
