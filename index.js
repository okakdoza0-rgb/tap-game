const TelegramBot = require('node-telegram-bot-api');

const token = process.env.8407383766:AAECu0jVu9Up7R-N3MehalGHJk-XYrSrtWY

;

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
`👋 Добро пожаловать в ArTap!

👆 Тапай Artemwe
💰 Зарабатывай монеты
⚡ Улучшай свою силу
🏆 Стань лучшим игроком

Начни тапать прямо сейчас 🚀`
  );
});

console.log('Bot started');
