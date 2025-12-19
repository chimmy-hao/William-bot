const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('🔕 Activa o desactiva los recordatorios automáticos de William.')
    .addStringOption(option =>
      option.setName('estado')
        .setDescription('¿Quieres recibir notificaciones?')
        .setRequired(true)
        .addChoices(
          { name: '✅ Encender (ON)', value: 'true' },
          { name: '🔕 Apagar (OFF)', value: 'false' }
        )
    ),

  async execute(interaction, supabase) {
    const userId = interaction.user.id;
    const choice = interaction.options.getString('estado') === 'true';

    try {
      await interaction.deferReply({ ephemeral: true });

      // Actualizamos la preferencia del usuario
      const { error } = await supabase
        .from('users')
        .update({ reminders_enabled: choice })
        .eq('user_id', userId);

      if (error) throw error;

      // Mensaje de confirmación
      const embed = new EmbedBuilder()
        .setColor(choice ? '#2ecc71' : '#e74c3c')
        .setTitle(choice ? '🔔 Notificaciones Activadas' : '🔕 Notificaciones Desactivadas')
        .setDescription(choice 
          ? 'William te avisará cuando tus cooldowns terminen.\n¡A trabajar!' 
          : 'Entendido. William no te molestará con recordatorios automáticos.'
        );

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en /notifications:', error);
      await interaction.editReply({ content: '❌ Hubo un error al guardar tu preferencia.', ephemeral: true });
    }
  }
};
