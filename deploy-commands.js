// deploy-commands.js
// Registra tus comandos de slash en Discord (globales o por servidor).
// Usa .env con DISCORD_TOKEN, CLIENT_ID y opcionalmente GUILD_ID para deploy instantáneo.

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of files) {
  const command = require(path.join(commandsPath, file));
  if (command?.data) commands.push(command.data.toJSON());
}

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('❌ Falta DISCORD_TOKEN o CLIENT_ID en tu .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`🔄 Subiendo ${commands.length} comando(s) ...`);

    if (process.env.GUILD_ID) {
      // Deploy instantáneo en un solo servidor (recomendado para pruebas)
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log('✅ Comandos de servidor desplegados (instantáneo).');
    } else {
      // Deploy global (tarda hasta 1 hora en propagarse)
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log('✅ Comandos globales desplegados (pueden tardar en aparecer).');
    }
  } catch (error) {
    console.error('Error al desplegar comandos:', error);
    process.exit(1);
  }
})();
