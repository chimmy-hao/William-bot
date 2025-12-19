const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http'); 
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// 🌐 SERVIDOR WEB (Para que Render no se duerma)
// ==========================================
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('William Bot is online!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Server listening on port ${PORT}`);
}).on('error', (err) => {
    console.error('❌ Server error:', err);
});

// Conexión Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Limpieza de temporales
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

function cleanupTempDirectory() {
    try {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
        }
        console.log('🧹 Temp cleaned');
    } catch (error) {
        console.error('❌ Error cleaning temp:', error);
    }
}
setInterval(cleanupTempDirectory, 3600000);

// Cliente Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();

// Cargar Comandos
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

// Deploy Manual (Necesario para que el autocomplete funcione)
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
// ⏰ NOTIFICACIONES (Versión Completa)
// ==========================================
const COOLDOWNS = {
    WORK: 3 * 60 * 1000,
    PHOTOCARD: 5 * 60 * 1000,
    DAILY: 12 * 60 * 60 * 1000,
    WEEKLY: 7 * 24 * 60 * 60 * 1000
};

setInterval(async () => {
    try {
        const now = Date.now();
        // Buscamos usuarios que tengan ALGUNA notificación pendiente (false)
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .or('work_notified.eq.false,daily_notified.eq.false,weekly_notified.eq.false,photocard_notified.eq.false,alpha_notified.eq.false,licuadora_notified.eq.false')
            .limit(20);

        if (error || !users || users.length === 0) return;

        for (const user of users) {
            // Si no hay canal guardado, saltamos (para evitar errores)
            if (!user.last_channel_id) continue;

            const channel = await client.channels.fetch(user.last_channel_id).catch(() => null);
            if (!channel) continue;

            let updates = {};
            let messages = [];

            // --- WORK ---
            if (user.work_notified === false) {
                if (now >= (user.last_work_claim || 0) + COOLDOWNS.WORK) {
                    messages.push("trabajar 💼");
                    updates.work_notified = true;
                }
            }
            // --- PHOTOCARD ---
            if (user.photocard_notified === false) {
                if (now >= (user.last_photocard_claim || 0) + COOLDOWNS.PHOTOCARD) {
                    messages.push("buscar cartas 🎰");
                    updates.photocard_notified = true;
                }
            }
            // --- DAILY ---
            if (user.daily_notified === false) {
                if (now >= (user.last_daily_claim || 0) + COOLDOWNS.DAILY) {
                    messages.push("reclamar daily 📅");
                    updates.daily_notified = true;
                }
            }
            // --- WEEKLY ---
            if (user.weekly_notified === false) {
                if (now >= (user.last_weekly_claim || 0) + COOLDOWNS.WEEKLY) {
                    messages.push("reclamar pack semanal 🗓️");
                    updates.weekly_notified = true;
                }
            }
            // --- ALPHA (Usa Reset Time específico) ---
            if (user.alpha_notified === false) {
                if (now >= (user.alpha_reset_time || 0)) {
                    messages.push("intentar Proyecto Alpha 🐺");
                    updates.alpha_notified = true;
                }
            }
            // --- LICUADORA (Usa Reset Time específico) ---
            if (user.licuadora_notified === false) {
                if (now >= (user.licuadora_reset_time || 0)) {
                    messages.push("usar la Licuadora 🌪️");
                    updates.licuadora_notified = true;
                }
            }

            // ENVIAR MENSAJE SI HAY NOVEDADES
            if (messages.length > 0 && Object.keys(updates).length > 0) {
                await channel.send(`Hey <@${user.user_id}>, William ya está listo para **${messages.join(' y para ')}**!`).catch(() => {});
                
                // Marcar como notificado en la DB
                await supabase.from('users').update(updates).eq('user_id', user.user_id);
            }
        }
    } catch (e) {
        console.error("Error notificaciones:", e);
    }
}, 60000); // Revisa cada 60 segundos


// Evento Ready
client.once(Events.ClientReady, async readyClient => {
    console.log(`🤖 Logged in as ${readyClient.user.tag}`);
    client.user.setPresence({ activities: [{ name: 'ทัก (FIRST SIGHT) - LYKN', type: 2 }], status: 'online' });
    
    // Deploy al iniciar
    await deployCommands(); 
    cleanupTempDirectory();
});

// Evento Interaction
client.on(Events.InteractionCreate, async interaction => {
    try {
        const command = client.commands.get(interaction.commandName);

        // Manejo de Autocomplete
        if (interaction.isAutocomplete()) {
            if (command && command.autocomplete) {
                await command.autocomplete(interaction, supabase);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        // 🟢 RESTAURAMOS LA MEMORIA DEL CANAL (DE FORMA SEGURA) 🟢
        // Esto permite que el bot sepa dónde pinguearte si te cambias de canal
        if (interaction.channelId) {
            // Usamos destructuración para manejar el error sin crash
            const { error } = await supabase.from('users').upsert({
                user_id: interaction.user.id,
                last_channel_id: interaction.channelId
            }, { onConflict: 'user_id' });
            
            // Si falla, solo lo logueamos en consola, NO rompemos el comando
            if (error) console.log("Nota: No se pudo guardar el canal (Supabase), pero el comando sigue.");
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

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

loadCommands();
client.login(process.env.DISCORD_TOKEN);
