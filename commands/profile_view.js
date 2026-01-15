const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const moneyEmoji = '<:berrycoin:1411737957081288724>';
const backpackEmoji = '🎒';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile_view')
    .setDescription('👤 Ver tu perfil o el de otro usuario')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('¿El perfil de quién quieres ver?')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    try {
      await interaction.deferReply();

      // 1. Buscar datos del usuario
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (userError || !user) {
        const msg = targetUser.id === interaction.user.id 
          ? '❌ No tienes un perfil registrado aún.' 
          : `❌ **${targetUser.username}** no tiene un perfil registrado.`;
        
        return interaction.editReply(msg);
      }

      // 2. Contar cartas
      const { count, error: countError } = await supabase
        .from('user_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (countError) {
        return interaction.editReply('❌ Error al contar las cartas.');
      }

      // 3. Buscar carta favorita
      let favCardInfo = 'Ninguna seleccionada';
      let favCardImage = null;

      if (user.favorite_card_id) {
        const { data: favCard, error: favError } = await supabase
          .from('user_cards')
          .select(`unique_card_id, base_cards (name, group_name, image_url)`)
          .eq('unique_card_id', user.favorite_card_id)
          .eq('user_id', userId)
          .single();

        if (!favError && favCard && favCard.base_cards) {
          favCardInfo = `**${favCard.base_cards.name}** (${favCard.base_cards.group_name || 'Soloist'})`;
          favCardImage = favCard.base_cards.image_url;
        }
      }

      // 4. LÓGICA DE FOTO (Automática)
      const avatarUrl = user.profile_image ? user.profile_image : targetUser.displayAvatarURL({ dynamic: true });

      // 5. Crear Embed (Orden Reorganizado)
      const embed = new EmbedBuilder()
        .setColor('#1abc9c')
        .setTitle(`👤 Perfil de ${targetUser.username}`)
        .setThumbnail(avatarUrl)
        .addFields(
          // Fila 1: Economía y Colección
          { name: `${moneyEmoji} Balance`, value: `${user.balance}`, inline: true },
          { name: `${backpackEmoji} Cartas`, value: `${count}`, inline: true },
          
          // Fila 2: Fecha de inicio
          { name: '📅 Jugando desde', value: user.created_at ? new Date(user.created_at).toLocaleDateString('es-ES') : 'Desconocido', inline: true },

          // Fila 3: Racha (Línea propia antes del Idol)
          { name: '🔥 Racha', value: `${user.daily_streak || 0} días`, inline: false },

          // Fila 4: Idol Favorito
          { name: '⭐ Tu Idol', value: favCardInfo, inline: false }
        )
        .setTimestamp();

      if (favCardImage) {
        embed.setImage(favCardImage);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error en profile_view:', err);
      await interaction.editReply('❌ Hubo un error al mostrar el perfil.');
    }
  }
};
