const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const app = express();

app.use(express.json());

/*
Храним пользователей
id -> true
*/
const users = {};

/*
Реферальные награды
*/
const rewards = {};

/* /start */
bot.onText(/\/start(?: (.+))?/, (msg, match) => {

const chatId = msg.chat.id;
const username = msg.from.username || msg.from.first_name;

const referrer = match[1];

/*
Проверяем новый ли игрок
*/
const isNewUser = !users[chatId];

if (isNewUser) {

users[chatId] = true;

/*
Если есть реферал
*/
if (referrer && referrer != chatId) {

if (!rewards[referrer]) {
rewards[referrer] = 0;
}

rewards[referrer] += 1000;

/*
Сообщение пригласившему
*/
bot.sendMessage(referrer,
`🎉 Новый игрок перешёл по твоей ссылке!

Игрок: @${username}

🪙 Ты получил 1000`
);

}

}

bot.sendMessage(chatId,
`🎮 Добро пожаловать в *ArTap!*

👆 Тапай по Artemwe  
🪙 Зарабатывай монеты  
⚡ Прокачивай силу клика  
🏆 Стань лучшим игроком  

🚀 Начни играть прямо сейчас!`,
{ parse_mode: "Markdown" });

});


/* команда пригласить */
bot.onText(/\/invite/, (msg) => {

const chatId = msg.chat.id;

const link = `https://t.me/ArTapclicker_bot?start=${chatId}`;

bot.sendMessage(chatId,
`👥 Пригласи друзей

Твоя ссылка:

${link}

За каждого друга +1000 🪙`
);

});


/* API для игры */
app.get('/reward/:id', (req, res) => {

const id = req.params.id;

const reward = rewards[id] || 0;

res.json({
reward
});

});


/* забрать награду */
app.post('/claim', (req, res) => {

const id = req.body.id;

const reward = rewards[id] || 0;

rewards[id] = 0;

res.json({
reward
});

});


/* сервер */
app.get('/', (req, res) => {
res.send('Bot running');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log("Server running");
});
