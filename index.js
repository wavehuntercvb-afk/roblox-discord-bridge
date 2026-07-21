const express = require("express");
const cors = require("cors");
const { Client, GatewayIntentBits, Events } = require("discord.js");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = path.join(process.cwd(), "database.json");

// 1. CLIENTE DISCORD
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 2. BASE DE DATOS
function loadDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { verifiedUsers: {} };
    saveDatabase(initial);
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch (err) {
    const initial = { verifiedUsers: {} };
    saveDatabase(initial);
    return initial;
  }
}

function saveDatabase(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function isVerified(discordId) {
  const db = loadDatabase();
  return discordId in db.verifiedUsers;
}

function verifyUser(discordId, username, robloxId) {
  const db = loadDatabase();
  db.verifiedUsers[discordId] = {
    id: discordId,
    username,
    robloxId: String(robloxId),
    verifiedAt: new Date().toISOString(),
  };
  saveDatabase(db);
}

function findByRobloxId(robloxId) {
  const db = loadDatabase();
  return Object.values(db.verifiedUsers).find((u) => String(u.robloxId) === String(robloxId)) || null;
}

// 3. COMANDOS DEL BOT (CORREGIDO AL 100%)
const PREFIX = "!";
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const parts = message.content.trim().split(/\s+/);
  const command = parts[0].slice(PREFIX.length).toLowerCase(); // CORRECCIÓN: Extrae el texto del comando limpio
  const args = parts.slice(1);

  if (command === "verify") {
    const robloxId = args[0]; // CORRECCIÓN: Extrae el número puro del ID
    if (!robloxId || !/^\d+$/.test(robloxId)) {
      await message.reply("❌ Uso correcto: `!verify <ID de Roblox>`\nEjemplo: `!verify 123456789`").catch(console.error);
      return;
    }
    verifyUser(discordId, username, robloxId);
    await message.reply(`✅ **${message.author.username}** verificado correctamente con ID de Roblox \`${robloxId}\`.`).catch(console.error);
  }
});

// 4. ENDPOINTS PARA ROBLOX Y NAVEGADOR
app.get("/api/get-roles/:robloxId", async (req, res) => {
  const header = req.headers["authorization"] || "";
  const secret = process.env["API_SECRET"] || "";
  if (header !== secret && header !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const user = findByRobloxId(req.params.robloxId);
  if (!user) return res.status(404).json({ success: false, error: "Not found" });

  const guild = client.guilds.cache.get(process.env["DISCORD_GUILD_ID"] || "");
  if (!guild) return res.status(500).json({ success: false, error: "Guild error" });

  try {
    const member = await guild.members.fetch(user.id);
    const roles = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.id);
    return res.json({ success: true, roles });
  } catch (error) {
    return res.status(404).json({ success: false, error: "No member" });
  }
});

app.get("/api/verificar", (req, res) => {
  const robloxId = req.query.roblox;
  const discordId = req.query.discord;
  if (!robloxId || !discordId) return res.send("Faltan datos");
  verifyUser(discordId, "ManualUser", robloxId);
  res.send(`¡Vinculado con éxito! Roblox: ${robloxId} mapeado a Discord: ${discordId}`);
});

client.once(Events.ClientReady, (c) => console.log(`[BOT] Conectado: ${c.user.tag}`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[WEB] Puerto ${PORT}`));
if (process.env["DISCORD_TOKEN"]) client.login(process.env["DISCORD_TOKEN"]);
