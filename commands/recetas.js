// 1. Importamos AttachmentBuilder
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');

// --- CONFIGURACIÓN DE RECETAS ---
const RECIPES = [
  {
    name: 'Banana Pack',
    emoji: '<:pack_banana:1413292531134759053>',
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
    // 2. Preparamos la imagen como archivo adjunto
    // Asegúrate de que el archivo 'licuadora.png' esté en la carpeta principal del bot
    const blenderImage = new AttachmentBuilder('./licuadora.png');

    const embed = new EmbedBuilder()
      .setTitle('🌪️ Recetario de la Licuadora')
      .setDescription('Combina tus cartas repetidas para crear nuevos Packs.\nUsa el comando `/licuadora` seguido de los códigos.')
      .setColor('#FFA500') // Naranja
      // 3. Usamos la imagen adjunta como miniatura
      .setThumbnail('attachment://licuadora.png') 
      .setTimestamp();

    RECIPES.forEach(recipe => {
      embed.addFields({
        name: `${recipe.emoji} __${recipe.name}__`,
        value: recipe.desc,
        inline: true 
      });
    });

    // 4. Enviamos el embed JUNTO con el archivo
    await interaction.reply({ embeds: [embed], files: [blenderImage] });
  }
};
