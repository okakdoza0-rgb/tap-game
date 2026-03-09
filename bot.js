const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// команда /start
bot.onText(/\/start/, (msg) => {

  bot.sendMessage(
    msg.chat.id,
`🎮 Добро пожаловать в *ArTap!*

👆 Тапай по Artemwe  
🪙 Зарабатывай монеты  
⚡ Прокачивай силу клика  
🏆 Стань лучшим игроком  

🚀 Нажми «Играть» и начинай тапать!`,
{
parse_mode: "Markdown",
reply_markup: {
inline_keyboard: [
[
{
text: "🎮 Играть",
web_app: {
url: "https://tap-game-oxjs.onrender.com"
}
}
]
]
}
}
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
