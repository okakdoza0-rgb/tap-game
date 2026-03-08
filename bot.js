const TelegramBot = require('node-telegram-bot-api');

const token = 'TOKEN_БОТА';
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "👆 Тапай Artemwe\n🪙 Зарабатывай монеты\n⚡ Улучшай силу");
});
