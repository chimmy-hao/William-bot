const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http'); 
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// 🌐 SERVIDOR WEB (KEEPALIVE)
// ==========================================
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('William Bot is online!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Server listening on port ${PORT}`);
});

// ==========================================
// CONFIGURACIÓN SUPABASE
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
} else {
    console.error("⚠️ ADVERTENCIA: Faltan credenciales de SUPABASE.");
}

// ==========================================
// LIMPIEZA DE TEMPORALES
// ==========================================
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

function cleanupTempDirectory() {
    try {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error('❌ Error cleaning temp:', error);
    }
}
setInterval(cleanupTempDirectory, 3600000);

// ==========================================
// CLIENTE DISCORD
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers    
    ]
});

client.commands = new Collection();

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
            }
        } catch (error) {
            console.error(`❌ Error loading ${file}:`, error);
        }
    }
    console.log(`✅ Loaded ${client.commands.size} commands.`);
}

async function deployCommands() {
    const commands = [];
    for (const command of client.commands.values()) commands.push(command.data.toJSON());

    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('🔄 Deploying commands...');
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
        } else {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
        }
        console.log('✅ Commands deployed successfully.');
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
}

// ==========================================
// ⏰ NOTIFICACIONES INTELIGENTES (REMINDERS)
// ==========================================
const COOLDOWNS = {
    WORK: 5 * 60 * 1000,
    PHOTOCARD: 5 * 60 * 1000,
    GOLIVE: 5 * 60 * 1000,
    FREESTYLE: 15 * 60 * 1000,
    WORLD_TOUR: 15 * 60 * 1000,
    DAILY: 12 * 60 * 60 * 1000,
    WEEKLY: 7 * 24 * 60 * 60 * 1000
};

setInterval(async () => {
    try {
        if (!supabase) return; 
        const now = Date.now();
        
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .or('work_notified.eq.false,daily_notified.eq.false,weekly_notified.eq.false,photocard_notified.eq.false,golive_notified.eq.false,freestyle_notified.eq.false,world_tour_notified.eq.false,alpha_notified.eq.false,licuadora_notified.eq.false')
            .limit(30);

        if (error || !users || users.length === 0) return;

        for (const user of users) {
            if (!user.last_channel_id) continue;

            let updates = {};
            let messages = [];
            let shouldSend = false;

            // 1. WORK
            if (user.work_notified === false && now >= (user.last_work_claim || 0) + COOLDOWNS.WORK) {
                updates.work_notified = true;
                if (user.pref_work !== false) { messages.push("trabajar 💼"); shouldSend = true; }
            }
            // 2. GOLIVE
            if (user.golive_notified === false && now >= (user.last_golive_claim || 0) + COOLDOWNS.GOLIVE) {
                updates.golive_notified = true;
                if (user.pref_golive !== false) { messages.push("hacer Live Stream 🔴"); shouldSend = true; }
            }
            // 3. FREESTYLE
            if (user.freestyle_notified === false && now >= (user.last_freestyle || 0) + COOLDOWNS.FREESTYLE) {
                updates.freestyle_notified = true;
                if (user.pref_freestyle !== false) { messages.push("practicar Freestyle 🎤"); shouldSend = true; }
            }
            // 4. PHOTOCARD
            if (user.photocard_notified === false && now >= (user.last_photocard_claim || 0) + COOLDOWNS.PHOTOCARD) {
                updates.photocard_notified = true;
                if (user.pref_photocard !== false) { messages.push("buscar cartas 🎰"); shouldSend = true; }
            }
            // 5. WORLD TOUR
            if (user.world_tour_notified === false) {
                const { data: tour } = await supabase.from('world_tours').select('last_checkin').eq('user_id', user.user_id).single();
                const lastCheckin = tour?.last_checkin ? new Date(tour.last_checkin).getTime() : 0;
                
                if (now >= lastCheckin + COOLDOWNS.WORLD_TOUR) {
                    updates.world_tour_notified = true;
                    if (user.pref_world_tour !== false) { messages.push("continuar el World Tour 🌍"); shouldSend = true; }
                }
            }
            // 6. DAILY
            if (user.daily_notified === false && now >= (user.last_daily_claim || 0) + COOLDOWNS.DAILY) {
                updates.daily_notified = true;
                if (user.pref_daily !== false) { messages.push("reclamar daily 📅"); shouldSend = true; }
            }
            // 7. WEEKLY
            if (user.weekly_notified === false && now >= (user.last_weekly_claim || 0) + COOLDOWNS.WEEKLY) {
                updates.weekly_notified = true;
                if (user.pref_weekly !== false) { messages.push("reclamar pack semanal 🗓️"); shouldSend = true; }
            }
            // 8. ALPHA & LICUADORA
            if (user.alpha_notified === false && now >= (user.alpha_reset_time || 0)) {
                updates.alpha_notified = true;
                if (user.pref_alpha !== false) { messages.push("intentar Proyecto Alpha 🐺"); shouldSend = true; }
            }
            if (user.licuadora_notified === false && now >= (user.licuadora_reset_time || 0)) {
                updates.licuadora_notified = true;
                if (user.pref_licuadora !== false) { messages.push("usar la Licuadora 🌪️"); shouldSend = true; }
            }

            // ENVIAR NOTIFICACIÓN
            if (Object.keys(updates).length > 0) {
                if (shouldSend && messages.length > 0) {
                    const channel = await client.channels.fetch(user.last_channel_id).catch(() => null);
                    if (channel) {
                        const actionText = messages.length > 1 
                            ? messages.slice(0, -1).join(', ') + ' y ' + messages.slice(-1) 
                            : messages[0];

                        await channel.send(`Hey <@${user.user_id}>, William ya está listo para **${actionText}**!`).catch(() => {});
                    }
                }
                await supabase.from('users').update(updates).eq('user_id', user.user_id);
            }
        }
    } catch (e) {
        console.error("Error notificaciones:", e);
    }
}, 60000); 

// ==========================================
// EVENTOS DISCORD
// ==========================================

// Evento Ready
client.once(Events.ClientReady, async readyClient => {
    console.log(`🎉 LOGGED IN AS ${readyClient.user.tag}!`); // 👈 SI VES ESTO, FUNCIONA
    client.user.setPresence({ activities: [{ name: 'ทัก (FIRST SIGHT) - LYKN', type: 2 }], status: 'online' });
    
    await deployCommands(); 
    cleanupTempDirectory();
});

// Evento Interaction
client.on(Events.InteractionCreate, async interaction => {
    try {
        const command = client.commands.get(interaction.commandName);

        if (interaction.isAutocomplete()) {
            if (command && command.autocomplete) await command.autocomplete(interaction, supabase);
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        // Registro de canal para notificaciones
        if (interaction.channelId && supabase) {
             supabase.from('users').upsert({
                user_id: interaction.user.id,
                last_channel_id: interaction.channelId
            }, { onConflict: 'user_id' }).then(({ error }) => {
                if(error) console.error("Error saving channel:", error);
            });
        }
        
        if (!command) return;
        await command.execute(interaction, supabase);

    } catch (error) {
        console.error(`❌ Interaction Error:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Error executing command!', ephemeral: true }).catch(() => {});
        }
    }
});

// Manejo de errores globales
process.on('uncaughtException', (err) => {
    console.error('🔥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
    console.error('🔥 Unhandled Rejection:', err);
});

// ==========================================
// 🚀 ARRANQUE FINAL
// ==========================================

console.log("🔍 Starting bot...");
loadCommands();

const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error("❌ NO TOKEN FOUND in environment variables!");
} else {
    console.log("🔑 Token found. Attempting login...");
    client.login(token).catch(err => {
        console.error("\n💀 FATAL LOGIN ERROR:");
        console.error(err);
        console.error("\n👉 CHECK: 1. Token is correct. 2. Intents are enabled in Dev Portal.\n");
    });
}
