const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view')
    .setDescription('Muestra solo la imagen de las cartas que tenés en tu inventario')
    .addStringOption(option => 
      option.setName('codes')
            .setDescription('Códigos de las cartas separados por espacios (máx 10)')
            .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id.toString();
    let codes = interaction.options.getString('codes')
      .split(' ')
      .map(c => c.trim())
      .filter(c => c)
      .slice(0, 10);

    if (codes.length === 0) {
      return interaction.reply({ content: 'No se proporcionaron códigos válidos.', ephemeral: true });
    }

    // Traer solo cartas del usuario que estén en los códigos y no sean null
    const { data: userCards, error } = await supabase
      .from('user_cards')
      .select('unique_card_id, cards(*)')
      .in('unique_card_id', codes)
      .eq('user_id', userId)
      .not('unique_card_id', 'is', null);

    if (error) {
      console.error(error);
      return interaction.reply({ content: 'Error al consultar tu inventario.', ephemeral: true });
    }

    if (!userCards || userCards.length === 0) {
      return interaction.reply({ content: 'No se encontraron cartas de tu inventario con esos códigos.', ephemeral: true });
    }

    const embeds = userCards.map(uc => new EmbedBuilder()
      .setImage(uc.cards.image_url)
      .setColor('Blurple') // opcional, para que el embed no quede gris
    );

    await interaction.reply({ embeds });
  }
};
