const { SlashCommandBuilder, EmbedBuilder } = require('discord.js'); // Borré PermissionFlagsBits que ya no se usa
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Configuración
const REWARD_AMOUNT = 5000; // ¡Es dorada, vale mucho!
const MONEY_EMOJI = '<:berrycoin:1411737957081288724>';
const STRAWBERRY_IMG = 'https://media.tenor.com/P1U_LqudM7AAAAAM/strawberry-fruit.gif'; // Una frutilla brillante

// IDs de roles permitidos (Managers/Admins)
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strawberry')
        .setDescription('🍓 Evento de la Frutilla Dorada')
        .addSubcommand(sub =>
            sub.setName('hide')
                .setDescription('ADMIN: Esconde la frutilla en un canal.')
                .addChannelOption(option => 
                    option.setName('canal')
                    .setDescription('¿Dónde la escondemos?')
                    .setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('found')
                .setDescription('¡Reclama la frutilla si está en este canal!')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        try {
            // ================================================================
            // 🕵️‍♀️ HIDE (Solo para VOS/Admin según Roles)
            // ================================================================
            if (subcommand === 'hide') {
                // CORRECCIÓN: Usamos la lista de roles en lugar de permiso de Admin
                const memberRoles = interaction.member.roles.cache;
                const hasPermission = ALLOWED_ROLES.some(roleId => memberRoles.has(roleId));

                if (!hasPermission) {
                    return interaction.reply({ content: '❌ No tienes permisos para esconder la frutilla.', ephemeral: true });
                }

                const targetChannel = interaction.options.getChannel('canal');

                await interaction.deferReply({ ephemeral: true });

                // 1. Guardar en DB dónde está escondida
                const { error } = await supabase.from('game_state').upsert({ 
                    event_name: 'golden_strawberry', 
                    active_channel_id: targetChannel.id,
                    is_active: true 
                });

                if (error) {
                    console.error(error);
                    return interaction.editReply('❌ Error al guardar en base de datos.');
                }

                // 2. Mandar el mensaje en el canal objetivo
                const embed = new EmbedBuilder()
                    .setColor('#FFD700') // Dorado
                    .setTitle('✨ ¡APARECIÓ UNA FRUTILLA DORADA! ✨')
                    .setDescription(`¡Rápido! El primero en usar \`/strawberry found\` en este canal se lleva **${REWARD_AMOUNT}** ${MONEY_EMOJI}.`)
                    .setImage(STRAWBERRY_IMG);

                await targetChannel.send({ embeds: [embed] });

                return interaction.editReply(`✅ Frutilla escondida exitosamente en ${targetChannel}. ¡Que comiencen los juegos!`);
            }

            // ================================================================
            // 🏃‍♂️ FOUND (Para los usuarios)
            // ================================================================
            if (subcommand === 'found') {
                await interaction.deferReply();

                // 1. Consultar si hay una frutilla activa
                const { data: gameState } = await supabase
                    .from('game_state')
                    .select('*')
                    .eq('event_name', 'golden_strawberry')
                    .single();

                // Validaciones
                if (!gameState || !gameState.is_active) {
                    return interaction.editReply('❌ No hay ninguna Frutilla Dorada escondida en este momento.');
                }

                if (gameState.active_channel_id !== interaction.channelId) {
                    return interaction.editReply('❌ **Aquí no hay nada.** Sigue buscando en otros canales...');
                }

                // 2. ¡GANADOR! - Actualizar DB para que nadie más la gane
                await supabase.from('game_state').update({ is_active: false }).eq('event_name', 'golden_strawberry');

                // 3. Dar dinero al usuario
                const { data: user } = await supabase.from('users').select('balance').eq('user_id', userId).single();
                
                let newBalance = REWARD_AMOUNT;
                if (user) {
                    newBalance = (user.balance || 0) + REWARD_AMOUNT;
                    await supabase.from('users').update({ balance: newBalance }).eq('user_id', userId);
                } else {
                    await supabase.from('users').insert({ user_id: userId, balance: newBalance });
                }

                // --- AGREGADO: Log al Historial ---
                await supabase.from('history_logs').insert({
                    user_id: userId,
                    action_type: 'strawberry_win',
                    amount: REWARD_AMOUNT,
                    details: `Encontró la Frutilla Dorada en #${interaction.channel.name}`
                });
                // ----------------------------------

                // 4. Anunciar ganador
                const winEmbed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('🏆 ¡TENEMOS UN GANADOR!')
                    .setDescription(
                        `**${interaction.user.username}** encontró la Frutilla Dorada. 🍓\n\n` +
                        `💰 **Premio:** ${REWARD_AMOUNT} ${MONEY_EMOJI}\n` +
                        `📍 **Ubicación:** ${interaction.channel}`
                    )
                    .setFooter({ text: 'Atentos a la próxima ronda...' });

                return interaction.editReply({ embeds: [winEmbed] });
            }

        } catch (err) {
            console.error(err);
            interaction.editReply('❌ Ocurrió un error inesperado.');
        }
    }
};
