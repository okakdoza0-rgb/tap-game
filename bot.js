const TelegramBot = require('node-telegram-bot-api');

const token = '8668448787:AAH2w4EsedEnRMXXoWchIWubQAeIPTPZt5Q';
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
`🎮 Artemwe Tap

👆 Тапай и зарабатывай монеты
🪙 Копи баланс
⚡ Улучшай силу
🏆 Стань лучшим игроком`
);
});
