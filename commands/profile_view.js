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
    // AQUI AGREGAMOS LA OPCIÓN DE USUARIO
    .addUserOption(option => 
      option.setName('user')
        .setDescription('¿El perfil de quién quieres ver?')
        .setRequired(false) // Es opcional: si no pones nada, muestra el tuyo
    ),

  async execute(interaction) {
    // LÓGICA: Si seleccionaron un usuario, usamos ese. Si no, usamos al que escribió el comando.
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    try {
      await interaction.deferReply();

      // 1. Buscar datos del usuario en Supabase
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (userError || !user) {
        // Mensaje diferente si soy yo o si es otro
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
        console.error(countError);
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
          favCardInfo = `⭐ **${favCard.base_cards.name}** (${favCard.base_cards.group_name || 'sin grupo'})\n🆔 ${favCard.unique_card_id}`;
          favCardImage = favCard.base_cards.image_url;
        }
      }

      // 4. Crear Embed
      const embed = new EmbedBuilder()
        .setColor('#1abc9c')
        .setTitle(`👤 Perfil de ${targetUser.username}`) // Nombre del usuario objetivo
        .addFields(
          { name: `${moneyEmoji} Balance`, value: `${user.balance}`, inline: true },
          { name: `${backpackEmoji} Cartas`, value: `${count}`, inline: true },
          // AQUÍ ESTÁ EL CAMBIO: Agregado 'es-ES'
          { name: '📅 Jugando desde', value: user.created_at ? new Date(user.created_at).toLocaleDateString('es-ES') : 'Desconocido', inline: true },
          { name: '⭐ Favorita', value: favCardInfo }
        )
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true })) // Avatar del usuario objetivo
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
