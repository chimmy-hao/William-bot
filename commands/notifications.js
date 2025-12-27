const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('🔕 Configura qué recordatorios quieres recibir.')
    .addStringOption(option =>
      option.setName('tipo')
        .setDescription('Elige qué notificación configurar')
        .setRequired(true)
        .addChoices(
          { name: '💼 Work', value: 'pref_work' },
          { name: '📅 Daily', value: 'pref_daily' },
          { name: '🗓️ Weekly', value: 'pref_weekly' },
          { name: '🎰 Photocard', value: 'pref_photocard' },
          { name: '🐺 Alpha', value: 'pref_alpha' },
          { name: '🌪️ Licuadora', value: 'pref_licuadora' },
          { name: '🌍 World Tour', value: 'pref_world_tour' },
          { name: '🔴 Live Stream', value: 'pref_golive' },   // <--- AGREGADO
          { name: '🎤 Freestyle', value: 'pref_freestyle' },  // <--- AGREGADO
          { name: '🎚️ TODO (Activar/Desactivar todo)', value: 'all' }
        )
    )
    .addStringOption(option =>
      option.setName('estado')
        .setDescription('¿Encender o Apagar?')
        .setRequired(true)
        .addChoices(
          { name: '✅ Encender (ON)', value: 'true' },
          { name: '🔕 Apagar (OFF)', value: 'false' }
        )
    ),

  async execute(interaction, supabase) { // Se asume que supabase se pasa como argumento
    const userId = interaction.user.id;
    const type = interaction.options.getString('tipo');
    const newState = interaction.options.getString('estado') === 'true';

    try {
      await interaction.deferReply({ ephemeral: true });

      let updates = {};
      let description = '';

      if (type === 'all') {
        // Si elige TODO, actualizamos todas las columnas
        updates = {
            pref_work: newState,
            pref_daily: newState,
            pref_weekly: newState,
            pref_photocard: newState,
            pref_alpha: newState,
            pref_licuadora: newState,
            pref_world_tour: newState,
            pref_golive: newState,    // <--- AGREGADO
            pref_freestyle: newState  // <--- AGREGADO
        };
        description = newState 
            ? '✅ Has activado **TODAS** las notificaciones.' 
            : '🔕 Has desactivado **TODAS** las notificaciones.';
      } else {
        // Si elige una específica
        updates[type] = newState;
        const nameMap = {
            pref_work: 'Work', 
            pref_daily: 'Daily', 
            pref_weekly: 'Weekly',
            pref_photocard: 'Photocard', 
            pref_alpha: 'Alpha', 
            pref_licuadora: 'Licuadora',
            pref_world_tour: 'World Tour',
            pref_golive: 'Live Stream',   // <--- AGREGADO
            pref_freestyle: 'Freestyle'   // <--- AGREGADO
        };
        
        const friendlyName = nameMap[type] || type; // Fallback por seguridad
        description = newState 
            ? `✅ Notificaciones de **${friendlyName}** activadas.` 
            : `🔕 Notificaciones de **${friendlyName}** desactivadas.`;
      }

      // Guardar en Base de Datos
      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('user_id', userId);

      if (error) throw error;

      const embed = new EmbedBuilder()
        .setColor(newState ? '#2ecc71' : '#e74c3c')
        .setTitle('⚙️ Configuración Actualizada')
        .setDescription(description);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error notifications:', error);
      await interaction.editReply({ content: '❌ Error al guardar tu configuración.', ephemeral: true });
    }
  }
};
