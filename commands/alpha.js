const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Función auxiliar para generar ID único
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alpha')
    .setDescription('🐺 Envía una carta a Project Alpha: 50% de Ascender (Mejora), 50% de Eliminación.')
    .addStringOption(option => 
      option.setName('code')
        .setDescription('El código de la carta que quieres arriesgar en la competencia')
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const codeInput = interaction.options.getString('code').trim();

    await interaction.deferReply();

    try {
      // 1. VERIFICAR QUE LA CARTA EXISTA Y SEA DEL USUARIO
      const { data: cardData, error } = await supabase
        .from('user_cards')
        .select('*, base_cards(*)')
        .eq('unique_card_id', codeInput)
        .eq('user_id', userId)
        .single();

      if (error || !cardData) {
        return interaction.editReply('❌ No encontré esa carta o no te pertenece. Revisa el código.');
      }

      const currentRarity = cardData.rarity;

      // 2. VALIDAR QUE NO SEA YA RAREZA MÁXIMA (3)
      if (currentRarity >= 3) {
        return interaction.editReply('👑 ¡Esta carta ya es un verdadero **Alpha** (Rareza 3)! No puede ascender más.');
      }

      // 3. LA MECÁNICA DE RIESGO (50/50)
      const isSuccess = Math.random() < 0.5; // True = Ascenso, False = Eliminación

      // IMPORTANTE: La carta original siempre se sacrifica (se borra)
      await supabase
        .from('user_cards')
        .delete() 
        .eq('id', cardData.id);

      // CASO A: FRACASO (ELIMINACIÓN) ❌
      if (!isSuccess) {
        const embedFail = new EmbedBuilder()
          .setColor('#2b2b2b') // Gris oscuro / Negro (Luto)
          .setTitle('🐺❌ Eliminado de la Manada')
          .setDescription(`La carta **${cardData.base_cards.name}** no soportó la presión de Project Alpha.\nHa sido eliminada de la competencia y de tu inventario.`)
          .setFooter({ text: 'Better luck next time...' });

        return interaction.editReply({ embeds: [embedFail] });
      }

      // CASO B: ÉXITO (ASCENSO ALPHA) 🐺🌕
      
      const nextRarity = currentRarity + 1;
      
      // Buscamos una carta aleatoria de la SIGUIENTE rareza
      const { data: possibleUpgrades } = await supabase
        .from('base_cards')
        .select('*')
        .eq('rarity_level', nextRarity);

      if (!possibleUpgrades || possibleUpgrades.length === 0) {
        return interaction.editReply('⚠️ ¡Has sobrevivido! Pero no encontré cartas de nivel superior en la base de datos (Database Error).');
      }

      const newCardBase = possibleUpgrades[Math.floor(Math.random() * possibleUpgrades.length)];
      const newUniqueId = generateUniqueCardCode(newCardBase.card_code);

      // Insertamos la nueva carta mejorada
      await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: newCardBase.id,
        rarity: nextRarity,
        unique_card_id: newUniqueId
      });

      const embedSuccess = new EmbedBuilder()
        .setColor('#5865F2') // Azul Discord o un tono "Lobo Místico"
        .setTitle('🐺🌕 ¡Ascenso Alpha Exitoso!')
        .setDescription(`¡Un aullido de victoria! Tu carta ha demostrado su valor y ha evolucionado.`)
        .addFields(
          { name: 'Rango Anterior', value: `Rareza ${currentRarity}`, inline: true },
          { name: 'Nuevo Rango Alpha', value: `Rareza ${nextRarity} 🌟`, inline: true },
          { name: 'Carta Obtenida', value: `**${newCardBase.name}**\n\`${newUniqueId}\`` }
        )
        .setImage(newCardBase.image_url);

      return interaction.editReply({ embeds: [embedSuccess] });

    } catch (err) {
      console.error(err);
      return interaction.editReply('❌ Ocurrió un error inesperado en Project Alpha.');
    }
  }
};
