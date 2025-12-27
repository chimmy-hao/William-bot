const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Emoji de moneda (Para mostrar monto si existe)
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
        .setDescription('Ver registros de Packs (Aperturas, Compras, Transfers)')
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
    // SUBCOMANDO 4: ECONOMY (¡NUEVO!)
    .addSubcommand(subcommand =>
      subcommand
        .setName('economy')
        .setDescription('💰 Ver historial de ganancias (Work, Daily, Juegos)')
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

    try {
      // Consulta base: últimos 15 registros
      let query = supabase.from('history_logs').select('*').order('created_at', { ascending: false }).limit(15);
      
      let title = "";
      let color = "#2b2d31";

      // --- 1. USER ---
      if (subcommand === 'user') {
        const targetUser = interaction.options.getUser('usuario') || interaction.user;
        query = query.eq('user_id', targetUser.id);
        title = `📜 Historial de ${targetUser.username}`;
        color = "#3498db"; 
      }

      // --- 2. CARD ---
      else if (subcommand === 'card') {
        const code = interaction.options.getString('codigo');
        query = query.ilike('details', `%${code}%`);
        title = `🃏 Rastro de Carta: ${code}`;
        color = "#e91e63"; 
      }

      // --- 3. PACKS ---
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
        color = "#e67e22"; // Naranja
      }

      // --- 4. ECONOMY (LOGICA NUEVA) ---
      else if (subcommand === 'economy') {
        const targetUser = interaction.options.getUser('usuario');
        
        // Filtramos por las acciones que dan dinero
        query = query.in('action_type', ['work', 'daily', 'weekly', 'freestyle', 'golive', 'strawberry_win']);

        if (targetUser) {
            query = query.eq('user_id', targetUser.id);
            title = `💰 Historial Económico: ${targetUser.username}`;
        } else {
            title = `💰 Historial Global de Economía`;
        }
        color = "#2ecc71"; // Verde Dinero
      }

      // --- 5. STAFF ---
      else if (subcommand === 'staff') {
        query = query.in('action_type', ['reset_cooldown', 'admin_add', 'admin_ban', 'claim_creador']);
        title = `🛡️ Auditoría de Staff`;
        color = "#f1c40f"; 
      }

      // EJECUTAR CONSULTA
      const { data: logs, error } = await query;
      if (error) throw error;

      if (!logs || logs.length === 0) {
        return interaction.editReply('📂 No hay registros para mostrar.');
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setTimestamp();

      // Mapear los logs a campos visuales
      const fields = logs.map(log => {
        const dateUnix = Math.floor(new Date(log.created_at).getTime() / 1000);
        let icon = '📄';
        
        // Iconos dinámicos según el tipo de acción
        if (log.action_type.includes('open')) icon = '✂️';
        if (log.action_type.includes('buy')) icon = '🛒';
        if (log.action_type.includes('trade')) icon = '🤝';
        if (log.action_type.includes('fail')) icon = '🚫';
        if (log.action_type === 'pack_win') icon = '🎁';
        
        // Iconos para Economía
        const ecoTypes = ['work', 'daily', 'weekly', 'freestyle', 'golive', 'strawberry_win'];
        if (ecoTypes.includes(log.action_type)) icon = '💰';

        // Si el registro tiene un monto (amount), lo mostramos
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
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error history:', error);
      await interaction.editReply('❌ Error al obtener datos.');
    }
  }
};
