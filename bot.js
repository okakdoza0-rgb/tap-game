const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const app = express();
const PORT = process.env.PORT || 3000;

const leaderboardPath = path.join(__dirname, 'leaderboard.json');

app.use(express.json());
app.use(express.static(__dirname));

function readLeaderboard() {
  try {
    const raw = fs.readFileSync(leaderboardPath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
}

function writeLeaderboard(data) {
  fs.writeFileSync(leaderboardPath, JSON.stringify(data, null, 2));
}

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
      parse_mode: 'Markdown'
    }
  );
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/leaderboard', (req, res) => {
  const leaderboard = readLeaderboard()
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  res.json(leaderboard);
});

app.post('/save-score', (req, res) => {
  const { id, name, username, score } = req.body;

  if (!id || typeof score !== 'number') {
    return res.status(400).json({ ok: false });
  }

  const leaderboard = readLeaderboard();
  const existingIndex = leaderboard.findIndex((p) => p.id === id);

  const playerData = {
    id,
    name: name || 'Player',
    username: username || '',
    score
  };

  if (existingIndex !== -1) {
    if (score > leaderboard[existingIndex].score) {
      leaderboard[existingIndex] = playerData;
    }
  } else {
    leaderboard.push(playerData);
  }

  writeLeaderboard(leaderboard);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
