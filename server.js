const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
const db = new sqlite3.Database("./game.db");

app.use(cors());
app.use(express.json());

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      userId TEXT PRIMARY KEY,
      score INTEGER,
      energy INTEGER,
      maxEnergy INTEGER,
      clickPower INTEGER
    )
  `);
});

app.get("/get-player", (req, res) => {
  const userId = req.query.userId;

  db.get("SELECT * FROM players WHERE userId = ?", [userId], (err, row) => {
    if (row) {
      res.json(row);
    } else {
      db.run(
        "INSERT INTO players (userId,score,energy,maxEnergy,clickPower) VALUES (?,?,?,?,?)",
        [userId, 0, 500, 500, 1]
      );

      res.json({
        userId,
        score: 0,
        energy: 500,
        maxEnergy: 500,
        clickPower: 1
      });
    }
  });
});

app.post("/save-player", (req, res) => {
  const p = req.body;

  db.run(
    `
    INSERT INTO players (userId,score,energy,maxEnergy,clickPower)
    VALUES (?,?,?,?,?)
    ON CONFLICT(userId) DO UPDATE SET
    score=excluded.score,
    energy=excluded.energy,
    maxEnergy=excluded.maxEnergy,
    clickPower=excluded.clickPower
  `,
    [p.userId, p.score, p.energy, p.maxEnergy, p.clickPower]
  );

  res.json({ ok: true });
});

app.listen(3000, () => {
  console.log("Server started");
});
