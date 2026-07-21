// ====================================================================
// CONFIGURACIÓN DE LIBRERÍAS (EXPRESS, DISCORD.JS, FS, PATH)
// ====================================================================
const express = require("express");
const cors = require("cors");
const { Client, GatewayIntentBits, Events } = require("discord.js");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = path.join(process.cwd(), "database.json");

// 1. CLIENTE DISCORD COMPARTIDO
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 2. SISTEMA DE BASE DE DATOS LOCAL
function loadDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { verifiedUsers: {} };
    saveDatabase(initial);
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch (err) {
    console.error("Fallo al procesar database.json, reiniciando a vacío");
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
    robloxId,
    verifiedAt: new Date().toISOString(),
  };
  saveDatabase(db);
}

function unverifyUser(discordId) {
  const db = loadDatabase();
  delete db.verifiedUsers[discordId];
  saveDatabase(db);
}

function listVerified() {
  const db = loadDatabase();
  return Object.values(db.verifiedUsers);
}

function findByRobloxId(robloxId) {
  const db = loadDatabase();
  return Object.values(db.verifiedUsers).find((u) => u.robloxId === robloxId) || null;
}

// 3. COMANDOS DEL BOT DE DISCORD (CORREGIDO)
const PREFIX = "!";

async function handleMessage(message) {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const [command, ...args] = message.content.trim().split(/\s+/);
  const discordId = message.author.id;
  const username = message.author.username;

  switch (command?.toLowerCase()) {
    case "!verify": {
      const robloxId = args[0]; // CORRECCIÓN CRÍTICA: Extraer el primer argumento de la lista de texto
      if (!robloxId || !/^\d+$/.test(robloxId)) {
        await message.reply("❌ Uso correcto: `!verify <ID de Roblox>`\nEjemplo: `!verify 123456789`");
        return;
      }
      if (isVerified(discordId)) {
        await message.reply("✅ Ya estás verificado. Usa `!unverify` primero si quieres cambiar tu ID de Roblox.");
      } else {
        verifyUser(discordId, username, robloxId);
        await message.reply(`✅ **${username}** verificado correctamente con ID de Roblox \`${robloxId}\`.`);
        console.log(`[BOT] Usuario verificado: ${username} (Roblox: ${robloxId})`);
      }
      break;
    }
    case "!unverify": {
      if (!isVerified(discordId)) {
        await message.reply("❌ No estás verificado.");
      } else {
        unverifyUser(discordId);
        await message.reply(`❌ **${username}** ha sido desverificado.`);
        console.log(`[BOT] Usuario desverificado: ${username}`);
      }
      break;
    }
    case "!status": {
      const verified = isVerified(discordId);
      await message.reply(
        verified
          ? `✅ **${username}**, estás verificado.`
          : `❌ **${username}**, no estás verificado. Usa \`!verify <ID de Roblox>\` para verificarte.`
      );
      break;
    }
    case "!list": {
      const users = listVerified();
      if (users.length === 0) {
        await message.reply("📋 No hay usuarios verificados aún.");
      } else {
        const lines = users
          .map((u, i) => `${i + 1}. **${u.username}** — Roblox ID: \`${u.robloxId}\` — ${new Date(u.verifiedAt).toLocaleString("es-ES")}`)
          .join("\n");
        await message.reply(`📋 **Usuarios verificados (${users.length}):**\n${lines}`);
      }
      break;
    }
    case "!help": {
      await message.reply(
        "**Comandos disponibles:**\n" +
          "`!verify <ID de Roblox>` — Vincular y verificar tu cuenta\n" +
          "`!unverify` — Eliminar tu verificación\n" +
          "`!status` — Consultar tu estado de verificación\n" +
          "`!list` — Listar todos los usuarios verificados\n" +
          "`!help` — Mostrar este mensaje"
      );
      break;
    }
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`[BOT] Discord bot listo como: ${c.user.tag}`);
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(message).catch((err) => console.error("Error procesando mensaje de Discord:", err));
});

// 4. ENDPOINT PARA ROBLOX
function isAuthorized(req) {
  const header = req.headers["authorization"] || "";
  const secret = process.env["API_SECRET"] || "";
  return header === secret || header === `Bearer ${secret}`;
}

app.get("/api/get-roles/:robloxId", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const robloxId = String(req.params.robloxId);
  const user = findByRobloxId(robloxId);

  if (!user) {
    return res.status(404).json({ success: false, error: "Roblox ID not found in database" });
  }

  const guildId = process.env["DISCORD_GUILD_ID"] || "";
  if (!guildId) {
    return res.status(500).json({ success: false, error: "DISCORD_GUILD_ID not configured" });
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return res.status(500).json({ success: false, error: "Guild not found — check configuration" });
  }

  try {
    const member = await guild.members.fetch(user.id);
    const roles = member.roles.cache
      .filter((role) => role.id !== guild.id)
      .map((role) => role.id);
    
    return res.json({ success: true, roles });
  } catch (error) {
    return res.status(404).json({ success: false, error: "Discord member not found in guild" });
  }
});

app.get("/api/healthz", (req, res) => {
  res.json({ status: "ok" });
});

// 5. ENCENDIDO
const PORT = process.env.PORT || 3000;
app.use((req, res, next) => { next(); });
app.listen(PORT, () => {
  console.log(`[WEB] Servidor Express corriendo en el puerto ${PORT}`);
});

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN);
} else {
  console.error("CRÍTICO: No se encontró la variable DISCORD_TOKEN");
}
