const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http'); // 👈 Módulo necesario para el servidor web
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// 🌐 SERVIDOR WEB FALSO PARA RENDER
// ==========================================
// Esto engaña a Render para que crea que es una web y no apague el bot por error de puerto.
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('William Bot is running and ready!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Web server listening on port ${PORT}`);
});
// ==========================================


// Supabase connection
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

// Cleanup temp directory on startup
function cleanupTempDirectory() {
    try {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
        }
        console.log('🧹 Temp directory cleaned up');
    } catch (error) {
        console.error('❌ Error cleaning temp directory:', error);
    }
}

// Clean temp directory every hour
setInterval(cleanupTempDirectory, 3600000);

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Command collection
client.commands = new Collection();

// Load commands
function loadCommands() {
    const commandsPath = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath, { recursive: true });

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            delete require.cache[require.resolve(filePath)];
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
                console.log(`✅ Loaded command: ${command.data.name}`);
            } else {
                console.log(`⚠️ Command at ${filePath} is missing required "data" or "execute" property.`);
            }
        } catch (error) {
            console.error(`❌ Error loading command ${file}:`, error);
        }
    }
}

// Deploy slash commands
async function deployCommands() {
    const commands = [];
    for (const command of client.commands.values()) commands.push(command.data.toJSON());

    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('🔄 Started refreshing application (/) commands...');
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
            console.log('✅ Successfully reloaded guild application (/) commands.');
        } else {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
            console.log('✅ Successfully reloaded global application (/) commands.');
        }
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
}

// Bot ready event
client.once(Events.ClientReady, async readyClient => {
    console.log(`🤖 Bot is ready! Logged in as ${readyClient.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
    client.user.setActivity('Managing Photocards 📸', { type: 'WATCHING' });
    await deployCommands();
    cleanupTempDirectory();
});

// Interaction handler with autocomplete support
client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command || !command.autocomplete) return;

            await command.autocomplete(interaction, supabase);
            return;
        }

        if (!interaction.isChatInputCommand()) return;
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        await command.execute(interaction, supabase);
    } catch (error) {
        console.error(`❌ Error handling interaction:`, error);
        const errorMessage = { content: '❌ There was an error while executing this command!', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage).catch(() => {});
        } else {
            await interaction.reply(errorMessage).catch(() => {});
        }
    }
});

// Global error handlers
process.on('unhandledRejection', (reason, promise) => console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason));
process.on('uncaughtException', error => console.error('🚨 Uncaught Exception:', error));
client.on('error', error => console.error('🚨 Discord.js error:', error));
client.on('warn', info => console.warn('⚠️ Discord.js warning:', info));

// Graceful shutdown
function shutdown() {
    console.log('🛑 Graceful shutdown...');
    cleanupTempDirectory();
    client.destroy();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Load commands and login
loadCommands();
client.login(process.env.DISCORD_TOKEN).catch(error => { console.error('❌ Failed to login:', error); process.exit(1); });

// Hot reload commands in development
if (process.env.NODE_ENV === 'development') {
    console.log('🔥 Development mode: Hot reload enabled');
    const chokidar = require('chokidar');
    chokidar.watch('./commands/**/*.js').on('change', async (path) => {
        console.log(`🔄 Reloading command: ${path}`);
        loadCommands();
        await deployCommands();
    });
}