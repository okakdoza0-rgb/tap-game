const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const users = {};

bot.onText(/\/start/, (msg) => {

bot.sendMessage(msg.chat.id,
`👋 Добро пожаловать в ArTap!

👆 Тапай по Artemwe
🪙 Получай монеты
⚡ Улучшайся
🏆 Стань лучшим игроком

🎁 Напиши /bonus чтобы получить ежедневную награду`
);

});

bot.onText(/\/bonus/, (msg) => {

const id = msg.from.id;
const now = Date.now();

if(!users[id]){
users[id] = { lastBonus: 0, coins: 0 };
}

const last = users[id].lastBonus;

if(now - last >= 86400000){

users[id].coins += 500;
users[id].lastBonus = now;

bot.sendMessage(msg.chat.id,
`🎁 Ежедневная награда!

Ты получил:
+500 🪙`
);

}else{

const hours = Math.ceil((86400000 - (now - last)) / 3600000);

bot.sendMessage(msg.chat.id,
`⏳ Ты уже забрал награду.

Приходи через ${hours} часов`
);

}

});

console.log("Bot started");
