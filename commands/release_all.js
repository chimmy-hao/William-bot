const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Config Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('release_all')
    .setDescription('ADMIN: Activa todas las cartas ocultas en el Pool y avisa a los usuarios.'),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // 1. Verificar Permisos (SOLO EL ROL ESPECÍFICO)
      const allowedRoles = ['1412852141197885464']; 
      
      const memberRoles = interaction.member.roles.cache;
      const hasRole = allowedRoles.some(roleId => memberRoles.has(roleId));

      if (!hasRole) {
        return interaction.editReply('❌ No tienes permisos para usar este comando.');
      }

      // 2. Contar cuántas cartas hay ocultas
      const { count } = await supabase
        .from('base_cards')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', false);

      if (count === 0) {
        return interaction.editReply('🤷‍♂️ No hay cartas ocultas en el Pool. Todo lo que subiste ya es público.');
      }

      // 3. ACTIVAR TODO
      const { error } = await supabase
        .from('base_cards')
        .update({ is_active: true })
        .eq('is_active', false);

      if (error) throw new Error(error.message);

      // 4. Anuncio público en el canal de noticias (SIN @EVERYONE)
      const embed = new EmbedBuilder()
        .setColor('#00FF00') // Verde brillante
        .setTitle('🚀 ¡Las nuevas ya están acá!')
        .setDescription(
          `🎉 **¡Atención coleccionistas!**\n\n` +
          `Se han activado **${count}** nuevas cartas.\n` +
          `Todas las eras anunciadas previamente **ya se pueden conseguir** en drops y packs.\n\n` +
          `¡Mucha suerte! 🍀`
        )
        .setTimestamp();

      try {
        const channel = await interaction.client.channels.fetch('1411784592192573601');
        // AQUI ESTA EL CAMBIO: Se borró "content: '@everyone'"
        if (channel) await channel.send({ embeds: [embed] });
      } catch (channelError) {
        console.error('Error enviando anuncio:', channelError.message);
      }

      // 5. Confirmación privada
      await interaction.editReply(`✅ **¡Hecho!** Se han activado ${count} cartas correctamente y se envió el aviso (sin mención).`);

    } catch (err) {
      console.error('Error en release_all:', err);
      await interaction.editReply(`❌ Ocurrió un error al liberar las cartas: ${err.message}`);
    }
  },
};
