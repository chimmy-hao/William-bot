const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Emoji de moneda
const moneyEmoji = '<:berrycoin:1411737957081288724>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('📜 Consulta los registros y movimientos.')
    // SUBCOMANDO 1: USER
    .addSubcommand(subcommand =>
      subcommand
        .setName('user')
        .setDescription('Ver historial general de un usuario')
        .addUserOption(option => option.setName('usuario').setDescription('Usuario a consultar'))
    )
    // SUBCOMANDO 2: CARD
    .addSubcommand(subcommand =>
      subcommand
        .setName('card')
        .setDescription('Ver la historia de una carta específica')
        .addStringOption(option => option.setName('codigo').setDescription('Código único (ej: WMO.1234)').setRequired(true))
    )
    // SUBCOMANDO 3: PACKS
    .addSubcommand(subcommand =>
      subcommand
        .setName('packs')
        .setDescription('Ver registros de Packs')
        .addUserOption(option => option.setName('usuario').setDescription('Filtrar por usuario (Opcional)'))
        .addStringOption(option => 
            option.setName('accion')
                .setDescription('Filtrar por tipo de acción')
                .addChoices(
                    { name: '📦 Aperturas (Open)', value: 'pack_open' },
                    { name: '🛒 Compras (Buy)', value: 'pack_buy' },
                    { name: '🤝 Transferencias (Trade)', value: 'pack_trade' },
                    { name: '🎁 Regalos/Drops (Win)', value: 'pack_win' },
                    { name: '❌ Fallos', value: 'pack_fail' }
                )
        )
    )
    // SUBCOMANDO 4: ECONOMY
    .addSubcommand(subcommand =>
      subcommand
        .setName('economy')
        .setDescription('💰 Ver historial de ganancias')
        .addUserOption(option => option.setName('usuario').setDescription('Filtrar por usuario (Opcional)'))
    )
    // SUBCOMANDO 5: STAFF
    .addSubcommand(subcommand =>
      subcommand
        .setName('staff')
        .setDescription('Ver acciones administrativas')
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const subcommand = interaction.options.getSubcommand();

    // --- FUNCIÓN HELPER PARA CONSTRUIR LA CONSULTA ---
    // Esto nos permite reutilizar los filtros para contar el total y para pedir los datos de cada página
    const buildBaseQuery = () => {
        let query = supabase.from('history_logs').select('*', { count: 'exact' });
        let title = "";
        let color = "#2b2d31";

        // 1. USER
        if (subcommand === 'user') {
            const targetUser = interaction.options.getUser('usuario') || interaction.user;
            query = query.eq('user_id', targetUser.id);
            title = `📜 Historial de ${targetUser.username}`;
            color = "#3498db"; 
        }
        // 2. CARD
        else if (subcommand === 'card') {
            const code = interaction.options.getString('codigo');
            query = query.ilike('details', `%${code}%`);
            title = `🃏 Rastro de Carta: ${code}`;
            color = "#e91e63"; 
        }
        // 3. PACKS
        else if (subcommand === 'packs') {
            const targetUser = interaction.options.getUser('usuario');
            const actionType = interaction.options.getString('accion');

            if (actionType) {
                query = query.eq('action_type', actionType);
            } else {
                query = query.in('action_type', ['pack_open', 'pack_buy', 'pack_trade', 'pack_win', 'pack_fail']);
            }

            if (targetUser) {
                query = query.eq('user_id', targetUser.id);
                title = `📦 Historial de Packs: ${targetUser.username}`;
            } else {
                title = `📦 Historial Global de Packs`;
            }
            color = "#e67e22"; 
        }
        // 4. ECONOMY
        else if (subcommand === 'economy') {
            const targetUser = interaction.options.getUser('usuario');
            query = query.in('action_type', ['work', 'daily', 'weekly', 'freestyle', 'golive', 'strawberry_win']);

            if (targetUser) {
                query = query.eq('user_id', targetUser.id);
                title = `💰 Historial Económico: ${targetUser.username}`;
            } else {
                title = `💰 Historial Global de Economía`;
            }
            color = "#2ecc71"; 
        }
        // 5. STAFF
        else if (subcommand === 'staff') {
            query = query.in('action_type', ['reset_cooldown', 'admin_add', 'admin_ban', 'claim_creador']);
            title = `🛡️ Auditoría de Staff`;
            color = "#f1c40f"; 
        }

        return { query, title, color };
    };

    try {
        // 1. OBTENER EL CONTEO TOTAL DE REGISTROS (Para saber cuántas páginas son)
        // Usamos head: true para no descargar datos, solo contar.
        const baseData = buildBaseQuery();
        const { count, error: countError } = await baseData.query.select('*', { count: 'exact', head: true });

        if (countError) throw countError;
        if (count === 0) return interaction.editReply('📂 No hay registros para mostrar.');

        // 2. CONFIGURACIÓN DE PAGINACIÓN
        let page = 0;
        const ITEMS_PER_PAGE = 10;
        const totalPages = Math.ceil(count / ITEMS_PER_PAGE);

        // 3. FUNCIÓN PARA GENERAR EL EMBED DE UNA PÁGINA
        const generateEmbed = async (pageIndex) => {
            const { query, title, color } = buildBaseQuery(); // Reconstruimos la query base
            
            // Calculamos rango (ej: pagina 0 es de 0 a 9)
            const from = pageIndex * ITEMS_PER_PAGE;
            const to = from + ITEMS_PER_PAGE - 1;

            const { data: logs, error } = await query
                .order('created_at', { ascending: false })
                .range(from, to);

            if (error) throw error;

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setColor(color)
                .setFooter({ text: `Página ${pageIndex + 1} de ${totalPages} • Total: ${count} registros` })
                .setTimestamp();

            // Mapeo de logs (Tu lógica visual original)
            const fields = logs.map(log => {
                const dateUnix = Math.floor(new Date(log.created_at).getTime() / 1000);
                let icon = '📄';
                
                if (log.action_type.includes('open')) icon = '✂️';
                if (log.action_type.includes('buy')) icon = '🛒';
                if (log.action_type.includes('trade')) icon = '🤝';
                if (log.action_type.includes('fail')) icon = '🚫';
                if (log.action_type === 'pack_win') icon = '🎁';
                
                const ecoTypes = ['work', 'daily', 'weekly', 'freestyle', 'golive', 'strawberry_win'];
                if (ecoTypes.includes(log.action_type)) icon = '💰';

                let extraInfo = '';
                if (log.amount && log.amount > 0) {
                    extraInfo = `\nGanancia: **${log.amount}** ${moneyEmoji}`;
                }

                return {
                    name: `${icon} ${log.action_type.toUpperCase()} | <t:${dateUnix}:R>`,
                    value: `${log.details}${extraInfo}\nUsuario: <@${log.user_id}>` + (log.target_id ? ` → <@${log.target_id}>` : ''),
                    inline: false
                };
            });

            embed.addFields(fields);
            return embed;
        };

        // 4. FUNCIÓN PARA LOS BOTONES
        const generateButtons = (pageIndex) => {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev_hist')
                        .setLabel('⬅️ Anterior')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(pageIndex === 0),
                    new ButtonBuilder()
                        .setCustomId('next_hist')
                        .setLabel('Siguiente ➡️')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(pageIndex >= totalPages - 1)
                );
            return row;
        };

        // 5. ENVIAR MENSAJE INICIAL
        const initialEmbed = await generateEmbed(page);
        const initialComponents = totalPages > 1 ? [generateButtons(page)] : [];
        
        const message = await interaction.editReply({ 
            embeds: [initialEmbed], 
            components: initialComponents 
        });

        // 6. MANEJO DE BOTONES (COLLECTOR)
        if (totalPages > 1) {
            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 120000 // 2 minutos
            });

            collector.on('collect', async i => {
                if (i.customId === 'prev_hist') page--;
                if (i.customId === 'next_hist') page++;

                const newEmbed = await generateEmbed(page);
                const newButtons = generateButtons(page);

                await i.update({
                    embeds: [newEmbed],
                    components: [newButtons]
                });
            });

            collector.on('end', () => {
                // Desactivar botones al finalizar tiempo
                const disabledButtons = generateButtons(page);
                disabledButtons.components.forEach(btn => btn.setDisabled(true));
                interaction.editReply({ components: [disabledButtons] }).catch(() => {});
            });
        }

    } catch (error) {
      console.error('Error history:', error);
      await interaction.editReply('❌ Error al obtener datos.');
    }
  }
};
