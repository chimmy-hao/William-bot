const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('node:path'); // Necesario para encontrar la ruta correcta

// ... (La configuración RECIPES es igual a la de arriba) ...
const RECIPES = [
  {
    name: 'Banana Pack',
    emoji: '<:pack_banana:1413292531134759053>',
    desc: '• **8x** Cartas Rareza 1\n• **2x** Cartas Rareza 2',
    color: '#F1C40F'
  },
  {
    name: 'Grape Pack',
    emoji: '<:pack_grape:1413292369675157655>',
    desc: '• **4x** Cartas Rareza 1\n• **6x** Cartas Rareza 2',
    color: '#9B59B6'
  },
  {
    name: 'Kiwi Pack',
    emoji: '<:pack_kiwi:1413292487455408201>',
    desc: '• **4x** Cartas Rareza 1\n• **4x** Cartas Rareza 2\n• **2x** Cartas Rareza 3',
    color: '#2ECC71'
  }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recetas')
    .setDescription('📜 Muestra las combinaciones para la Licuadora'),

  async execute(interaction) {
    // __dirname es la carpeta "commands".
    // '..' significa "bajar una carpeta atrás" (al root) para buscar la imagen.
    const imagePath = path.join(__dirname, '..', 'licuadora.png');
    
    const blenderImage = new AttachmentBuilder(imagePath);

    const embed = new EmbedBuilder()
      .setTitle('🌪️ Recetario de la Licuadora')
      .setDescription('Combina tus cartas repetidas para crear nuevos Packs.\nUsa el comando `/licuadora` seguido de los códigos.')
      .setColor('#FFA500') 
      .setThumbnail('attachment://licuadora.png') 
      .setTimestamp();

    RECIPES.forEach(recipe => {
      embed.addFields({
        name: `${recipe.emoji} __${recipe.name}__`,
        value: recipe.desc,
        inline: true 
      });
    });

    await interaction.reply({ embeds: [embed], files: [blenderImage] });
  }
};
