const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// /start
bot.onText(/\/start/, (msg) => {

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

// /invite
bot.onText(/\/invite/, (msg) => {

const userId = msg.from.id;

bot.sendMessage(
msg.chat.id,
`👥 Пригласи друзей

Твоя ссылка:
https://t.me/ArTapclicker_bot?start=${userId}

За каждого друга +1000 🪙`
);

});

// сервер для Render
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
