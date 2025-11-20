const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view')
    .setDescription('📸 Visualiza hasta 10 cartas de TU inventario')
    .addStringOption(option => 
      option.setName('codes')
            .setDescription('Códigos separados por espacios (Ej: WMO.1234 WMO.5678)')
            .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const inputCodes = interaction.options.getString('codes');

    // 1. Procesar los códigos (máximo 10)
    const codes = inputCodes
      .split(/[\s,]+/)
      .filter(c => c.length > 0)
      .slice(0, 10);

    if (codes.length === 0) {
      return interaction.reply({ content: '❌ Debes escribir al menos un código.', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // 2. Consulta SEGURA a Supabase
      const { data: userCards, error } = await supabase
        .from('user_cards')
        .select(`
          unique_card_id,
          base_cards (
            name,
            group_name,
            image_url
          )
        `)
        .in('unique_card_id', codes)
        .eq('user_id', userId); // 🔒 CANDADO DE SEGURIDAD: Solo trae cartas si el dueño eres TÚ

      if (error) {
        console.error('Error view:', error);
        return interaction.editReply('❌ Error al buscar las cartas.');
      }

      // Si no encontró ninguna (o las que encontró son de otros), da error.
      if (!userCards || userCards.length === 0) {
        return interaction.editReply('❌ No tienes ninguna de esas cartas en tu inventario.');
      }

      // 3. Crear Embeds
      const embeds = userCards.map(card => {
        // Limpiamos el nombre para que se vea bonito (igual que en inventory)
        const cleanName = card.base_cards.name.split(' — ')[0].trim();
        
        return new EmbedBuilder()
          .setColor('#2b2d31')
          .setTitle(`${cleanName} — ${card.base_cards.group_name || 'Sin grupo'}`)
          .setDescription(`🆔 \`${card.unique_card_id}\``)
          .setImage(card.base_cards.image_url);
      });

      await interaction.editReply({ 
        content: `📸 Mostrando ${embeds.length} carta(s) de tu colección:`, 
        embeds: embeds 
      });

    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Error al ejecutar el comando.');
    }
  }
};
