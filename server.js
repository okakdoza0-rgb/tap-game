const express = require("express");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const DB = "players.json";

if (!fs.existsSync(DB)) {
fs.writeFileSync(DB, JSON.stringify({}));
}

function readDB() {
return JSON.parse(fs.readFileSync(DB));
}

function saveDB(data) {
fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

app.get("/load/:id", (req,res)=>{

const id = req.params.id;

let db = readDB();

if(!db[id]){
db[id] = {
coins:0,
energy:500,
maxEnergy:500,
click:1
};
saveDB(db);
}

res.json(db[id]);

});

app.post("/save/:id",(req,res)=>{

const id = req.params.id;

let db = readDB();

db[id] = req.body;

saveDB(db);

res.json({status:"ok"});

});

app.listen(PORT,()=>{
console.log("Server started");
});
