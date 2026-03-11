const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();
const db = new sqlite3.Database("./game.db");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      userId TEXT PRIMARY KEY,
      score INTEGER DEFAULT 0,
      clickPower INTEGER DEFAULT 1,
      boughtClick INTEGER DEFAULT 0,
      boughtSpeed INTEGER DEFAULT 0,
      incomeSeconds INTEGER DEFAULT 5,
      fastEnergy INTEGER DEFAULT 0,
      energy INTEGER DEFAULT 500,
      maxEnergy INTEGER DEFAULT 500,
      energyUpgradeCount INTEGER DEFAULT 0,
      currentSkin TEXT DEFAULT 'FA9BC995-07D9-4B53-AB69-3AD0DAD933B8.png',
      task10kDone INTEGER DEFAULT 0,
      taskBuy1UpgradeDone INTEGER DEFAULT 0,
      taskEmptyEnergyDone INTEGER DEFAULT 0,
      task2000EnergyDone INTEGER DEFAULT 0,
      energyWasZero INTEGER DEFAULT 0,
      lastTime INTEGER DEFAULT 0
    )
  `);
});

app.get("/get-player", (req, res) => {
  const userId = req.query.userId;

  if (!userId) {
    return res.status(400).json({ error: "No userId" });
  }

  db.get("SELECT * FROM players WHERE userId = ?", [userId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (row) {
      return res.json(row);
    }

    const newPlayer = {
      userId,
      score: 0,
      clickPower: 1,
      boughtClick: 0,
      boughtSpeed: 0,
      incomeSeconds: 5,
      fastEnergy: 0,
      energy: 500,
      maxEnergy: 500,
      energyUpgradeCount: 0,
      currentSkin: "FA9BC995-07D9-4B53-AB69-3AD0DAD933B8.png",
      task10kDone: 0,
      taskBuy1UpgradeDone: 0,
      taskEmptyEnergyDone: 0,
      task2000EnergyDone: 0,
      energyWasZero: 0,
      lastTime: Date.now()
    };

    db.run(
      `
      INSERT INTO players (
        userId
