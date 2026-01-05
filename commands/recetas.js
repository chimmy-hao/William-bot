const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// --- CONFIGURACIÓN DE RECETAS ---
// Esto es solo visual, asegúrate de que coincida con la lógica de licuadora.js
const RECIPES = [
  {
    name: 'Banana Pack',
    emoji: '<:pack_banana:1413292531134759053>', // Asegúrate de que este ID sea correcto
    desc: '• **8x** Cartas Rareza 1\n• **2x** Cartas Rareza 2',
    color: '#F1C40F' // Amarillo Banana
  },
  {
    name: 'Grape Pack',
    emoji: '<:pack_grape:1413292369675157655>',
    desc: '• **4x** Cartas Rareza 1\n• **6x** Cartas Rareza 2',
    color: '#9B59B6' // Violeta Uva
  },
  {
    name: 'Kiwi Pack',
    emoji: '<:pack_kiwi:1413292487455408201>',
    desc: '• **4x** Cartas Rareza 1\n• **4x** Cartas Rareza 2\n• **2x** Cartas Rareza 3',
    color: '#2ECC71' // Verde Kiwi
  }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recetas')
    .setDescription('📜 Muestra las combinaciones para la Licuadora'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🌪️ Recetario de la Licuadora')
      .setDescription('Combina tus cartas repetidas para crear nuevos Packs.\nUsa el comando `/licuadora` seguido de los códigos.')
      .setColor('#FFA500') // Naranja
      .setThumbnail('https://cdn-icons-png.flaticon.com/512/763/763812.png') // Icono aesthetic de cocina/receta
      .setTimestamp();

    RECIPES.forEach(recipe => {
      embed.addFields({
        name: `${recipe.emoji} __${recipe.name}__`,
        value: recipe.desc,
        inline: true // Se verán en cuadrícula si hay espacio
      });
    });

    await interaction.reply({ embeds: [embed] });
  }
};
