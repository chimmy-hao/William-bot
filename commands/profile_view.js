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
    .setDescription('👤 Ver tu perfil de jugador'),

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      await interaction.deferReply();

      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (userError || !user) {
        return interaction.editReply('❌ No encontré tu perfil.');
      }

      const { count, error: countError } = await supabase
        .from('user_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (countError) {
        console.error(countError);
        return interaction.editReply('❌ Error al contar tus cartas.');
      }

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
          favCardInfo = `⭐ **${favCard.base_cards.name}** (${favCard.base_cards.group_name || 'sin grupo'})\n🆔 ${favCard.unique_card_id}`;
          favCardImage = favCard.base_cards.image_url;
        }
      }

      const embed = new EmbedBuilder()
        .setColor('#1abc9c')
        .setTitle(`👤 Perfil de ${interaction.user.username}`)
        .addFields(
          { name: `${moneyEmoji} Balance`, value: `${user.balance}`, inline: true },
          { name: `${backpackEmoji} Cartas`, value: `${count}`, inline: true },
          { name: '📅 Jugando desde', value: user.created_at ? new Date(user.created_at).toLocaleDateString() : 'Desconocido', inline: true },
          { name: '⭐ Favorita', value: favCardInfo }
        )
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp();

      if (favCardImage) {
        embed.setImage(favCardImage);
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error en profile_view:', err);
      await interaction.editReply('❌ Hubo un error al mostrar tu perfil.');
    }
  }
};
