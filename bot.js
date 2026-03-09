const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// храним, кто уже заходил
const users = {};

// /start + рефералка
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const userId = String(msg.from.id);
  const username = msg.from.username
    ? '@' + msg.from.username
    : msg.from.first_name || 'Игрок';

  const refId = match && match[1] ? String(match[1]) : null;

  // если пользователь зашел впервые
  if (!users[userId]) {
    users[userId] = true;

    // если зашел по реферальной ссылке
    if (refId && refId !== userId) {
      bot.sendMessage(
        refId,
`👥 Новый игрок перешёл по твоей ссылке!

Игрок: ${username}

🎉 Ты получил 1000 🪙

Продолжай приглашать друзей 🚀`
      );
    }
  }

  bot.sendMessage(
    msg.chat.id,
`🎮 Добро пожаловать в *ArTap!*

👆 Тапай по Artemwe  
🪙 Зарабатывай монеты  
⚡ Прокачивай силу клика  
🏆 Стань лучшим игроком  

🚀 Начни играть прямо сейчас!

👥 Напиши /invite чтобы пригласить друзей`,
    {
      parse_mode: 'Markdown'
    }
  );
});

// /invite
bot.onText(/\/invite/, (msg) => {
  const userId = String(msg.from.id);

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
  console.log('Server running on port ' + PORT);
});
