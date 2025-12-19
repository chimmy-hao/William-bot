const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http'); 
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// 🌐 SERVIDOR WEB FALSO PARA RENDER (KEEP-ALIVE)
// ==========================================
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('William Bot is running and ready!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Web server listening on port ${PORT}`);
}).on('error', (err) => {
    console.error('❌ Server error:', err);
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
            } else {
                console.log(`⚠️ Command at ${filePath} is missing "data" or "execute".`);
            }
        } catch (error) {
            console.error(`❌ Error loading command ${file}:`, error);
        }
    }
    console.log(`✅ ${client.commands.size} commands loaded.`);
}

// Deploy slash commands (FUNCIÓN MANUAL)
async function deployCommands() {
    const commands = [];
    for (const command of client.commands.values()) commands.push(command.data.toJSON());

    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('🔄 Refreshing application (/) commands...');
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
            console.log('✅ Guild commands reloaded.');
        } else {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
            console.log('✅ Global commands reloaded.');
        }
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
}

// ==========================================
// ⏰ SISTEMA DE NOTIFICACIONES (AUTO-PING)
// ==========================================
const COOLDOWNS = {
    WORK: 3 * 60 * 1000,
    PHOTOCARD: 5 * 60 * 1000,
    DAILY: 12 * 60 * 60 * 1000,
    WEEKLY: 7 * 24 * 60 * 60 * 1000
};

// Se ejecuta cada 60 segundos
setInterval(async () => {
    try {
        const now = Date.now();
        
        // Buscamos usuarios con notificaciones pendientes
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .or('work_notified.eq.false,daily_notified.eq.false,weekly_notified.eq.false,photocard_notified.eq.false,alpha_notified.eq.false,licuadora_notified.eq.false')
            .limit(20);

        if (error || !users || users.length === 0) return;

        for (const user of users) {
            // Si no sabemos en qué canal hablarle, saltamos al siguiente
            if (!user.last_channel_id) continue;

            // Intentamos obtener el canal donde usó el comando por última vez
            const channel = await client.channels.fetch(user.last_channel_id).catch(() => null);
            if (!channel) continue; // Si el canal fue borrado o no hay acceso

            let updates = {};
            let messages = [];

            // --- WORK ---
            if (user.work_notified === false) {
                const readyAt = (user.last_work_claim || 0) + COOLDOWNS.WORK;
                if (now >= readyAt) {
                    messages.push("acompañarte al trabajo 💼");
                    updates.work_notified = true;
                }
            }
            // --- PHOTOCARD ---
            if (user.photocard_notified === false) {
                const readyAt = (user.last_photocard_claim || 0) + COOLDOWNS.PHOTOCARD;
                if (now >= readyAt) {
                    messages.push("buscar nuevas cartas 🎰");
                    updates.photocard_notified = true;
                }
            }
            // --- DAILY ---
            if (user.daily_notified === false) {
                const readyAt = (user.last_daily_claim || 0) + COOLDOWNS.DAILY;
                if (now >= readyAt) {
                    messages.push("darte tu recompensa diaria 📅");
                    updates.daily_notified = true;
                }
            }
            // --- WEEKLY ---
            if (user.weekly_notified === false) {
                const readyAt = (user.last_weekly_claim || 0) + COOLDOWNS.WEEKLY;
                if (now >= readyAt) {
                    messages.push("entregarte tus provisiones semanales 🗓️");
                    updates.weekly_notified = true;
                }
            }
            // --- ALPHA (Usa Reset Time) ---
            if (user.alpha_notified === false) {
                if (now >= (user.alpha_reset_time || 0)) {
                    messages.push("realizar el Proyecto Alpha 🐺");
                    updates.alpha_notified = true;
                }
            }
            // --- LICUADORA (Usa Reset Time) ---
            if (user.licuadora_notified === false) {
                if (now >= (user.licuadora_reset_time || 0)) {
                    messages.push("encender la licuadora 🌪️");
                    updates.licuadora_notified = true;
                }
            }

            // ENVIAR MENSAJE
            if (messages.length > 0 && Object.keys(updates).length > 0) {
                const text = `Hey <@${user.user_id}>, William ya está listo para **${messages.join(' y para ')}**!`;
                
                await channel.send(text).catch(e => console.error("No pude enviar mensaje:", e));
                await supabase.from('users').update(updates).eq('user_id', user.user_id);
            }
        }
    } catch (err) {
        console.error("Error en loop notificaciones:", err);
    }
}, 60000);


// Bot ready event
client.once(Events.ClientReady, async readyClient => {
    console.log(`🤖 Bot is ready! Logged in as ${readyClient.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
    
    client.user.setPresence({
        activities: [{
            name: 'ทัก (FIRST SIGHT) - LYKN', 
            type: 2, // Listening
        }],
        status: 'online',
    });

    // Deploy commands activado para actualizar el autocompletado
    await deployCommands(); 
    console.log('✅ Commands deployed.');

    cleanupTempDirectory();
});

// Interaction handler with autocomplete support
client.on(Events.InteractionCreate, async interaction => {
    try {
        const command = client.commands.get(interaction.commandName);

        if (interaction.isAutocomplete()) {
            if (!command || !command.autocomplete) return;
            await command.autocomplete(interaction, supabase);
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        // 🟢 GUARDA EL CANAL ACTUAL PARA FUTURAS NOTIFICACIONES 🟢
        // Esto permite que el bot sepa dónde pinguearte
        if (interaction.channelId) {
            await supabase.from('users').upsert({
                user_id: interaction.user.id,
                last_channel_id: interaction.channelId
            }, { onConflict: 'user_id' }).catch(err => console.error("Error guardando canal:", err));
        }

        if (!command) return;

        await command.execute(interaction, supabase);
    } catch (error) {
        console.error(`❌ Error handling interaction:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Error executing command!', ephemeral: true }).catch(() => {});
        } else {
            await interaction.followUp({ content: '❌ Error executing command!', ephemeral: true }).catch(() => {});
        }
    }
});

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
    // console.error('🚨 Unhandled Rejection:', reason); 
});
process.on('uncaughtException', error => {
    console.error('🚨 Uncaught Exception:', error);
});
client.on('error', error => console.error('🚨 Discord Client error:', error));

// Graceful shutdown
function shutdown() {
    console.log('🛑 Shutting down...');
    cleanupTempDirectory();
    client.destroy();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Load commands and login
loadCommands();
client.login(process.env.DISCORD_TOKEN).catch(error => { 
    console.error('❌ Failed to login:', error); 
    process.exit(1); 
});
