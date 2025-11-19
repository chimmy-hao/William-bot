const { SlashCommandBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fav_photocard')
    .setDescription('⭐ Selecciona una photocard como favorita')
    .addStringOption(opt =>
      opt.setName('card_id')
        .setDescription('El ID único de la carta (unique_card_id)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const cardId = interaction.options.getString('card_id');

    try {
      await interaction.deferReply({ ephemeral: true });

      const { data: card, error: cardError } = await supabase
        .from('user_cards')
        .select('unique_card_id')
        .eq('user_id', userId)
        .eq('unique_card_id', cardId)
        .single();

      if (cardError || !card) {
        return interaction.editReply('❌ No tienes ninguna carta con ese ID.');
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({ favorite_card_id: cardId })
        .eq('user_id', userId);

      if (updateError) {
        console.error(updateError);
        return interaction.editReply('❌ Error al guardar tu carta favorita.');
      }

      await interaction.editReply(`⭐ Tu carta con ID \`${cardId}\` ha sido marcada como favorita.`);
    } catch (err) {
      console.error('Error en fav_photocard:', err);
      await interaction.editReply('❌ Hubo un error al seleccionar tu carta favorita.');
    }
  }
};
