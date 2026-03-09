const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const app = express();
app.use(express.json());

let referrals = {};

function loadReferrals(){
  try{
    referrals = JSON.parse(fs.readFileSync('./referrals.json'));
  }catch{
    referrals = {};
  }
}

function saveReferrals(){
  fs.writeFileSync('./referrals.json', JSON.stringify(referrals,null,2));
}

loadReferrals();

// START + рефералка
bot.onText(/\/start(?: (.+))?/, (msg, match) => {

const userId = String(msg.from.id);
const username = msg.from.username
? "@"+msg.from.username
: msg.from.first_name;

const refId = match[1];

if(refId && refId !== userId){

if(!referrals[refId]){
referrals[refId] = {reward:0, users:[]};
}

if(!referrals[refId].users.includes(userId)){

referrals[refId].users.push(userId);
referrals[refId].reward += 1000;

saveReferrals();

bot.sendMessage(
refId,
`👥 Новый игрок перешёл по твоей ссылке!

Игрок: ${username}

🎉 Ты получил 1000 🪙`
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

🚀 Начни играть прямо сейчас!`,
{parse_mode:"Markdown"}
);

});

// INVITE
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

// проверить награду
app.get("/reward/:id",(req,res)=>{

const id = req.params.id;

if(referrals[id]){
res.json({reward:referrals[id].reward});
}else{
res.json({reward:0});
}

});

// забрать награду
app.post("/claim",(req,res)=>{

const id = req.body.id;

if(referrals[id]){
let reward = referrals[id].reward;
referrals[id].reward = 0;
saveReferrals();

res.json({reward});
}else{
res.json({reward:0});
}

});

// сервер
app.get('/', (req, res) => {
res.send('Bot is running');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log("Server running");
});
