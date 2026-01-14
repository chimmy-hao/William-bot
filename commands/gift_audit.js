const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ID del Rol de Manager/Admin para proteger el uso
const MANAGER_ROLE_ID = '1412852141197885464'; 

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gift_audit')
    .setDescription('🕵️‍♀️ ADMIN: Ver historial de regalos reclamados')
    // 🔒 ESTO HACE QUE EL COMANDO NO SE VEA EN LA LISTA PÚBLICA (por defecto)
    .setDefaultMemberPermissions(0) 
    .addUserOption(opt => opt.setName('user').setDescription('Filtrar por usuario').setRequired(false))
    .addStringOption(opt => 
        opt.setName('type')
           .setDescription('Filtrar por tipo de evento')
           .addChoices(
               { name: 'Normal Gifts', value: 'gift' },
               { name: 'Mystery Gifts', value: 'gift_mystery' }
           )
    ),

  async execute(interaction) {
    // 1. Verificar Permisos (Doble seguridad)
    if (!interaction.member.roles.cache.has(MANAGER_ROLE_ID)) {
      return interaction.reply({ content: '🚫 Solo admins pueden ver esto.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true }); // Solo tú lo ves

    const targetUser = interaction.options.getUser('user');
    const typeFilter = interaction.options.getString('type');

    // 2. Construir Query
    let query = supabase
        .from('gift_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20); // Mostramos los últimos 20 reclamos

    if (targetUser) query = query.eq('user_id', targetUser.id);
    if (typeFilter) query = query.eq('event_source', typeFilter);

    const { data: logs, error } = await query;

    if (error) {
        console.error(error);
        return interaction.editReply('❌ Error al consultar la base de datos.');
    }
    
    if (!logs || logs.length === 0) return interaction.editReply('📭 No hay registros de regalos reclamados recientemente.');

    // 3. Crear Embed
    const embed = new EmbedBuilder()
        .setTitle('🕵️‍♀️ Auditoría de Regalos (Últimos 20)')
        .setColor('#e74c3c')
        .setTimestamp();

    const logText = logs.map(log => {
        const time = Math.floor(new Date(log.created_at).getTime() / 1000);
        const icon = log.event_source === 'gift_mystery' ? '🎲' : '🎁';
        return `${icon} <t:${time}:R> **${log.username}** reclamó: **${log.gift_detail}**`;
    }).join('\n');

    embed.setDescription(logText);

    await interaction.editReply({ embeds: [embed] });
  }
};
