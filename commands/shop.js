const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const packs = [
  { emoji: '<:pack_banana:1413292531134759053>', name: 'Banana Pack', code: 'banana', price: 1500 },
  { emoji: '<:pack_grape:1413292369675157655>', name: 'Grape Pack', code: 'grape', price: 2500 },
  { emoji: '<:pack_kiwi:1413292487455408201>', name: 'Kiwi Pack', code: 'kiwi', price: 4000 },
  { emoji: '<:pack_orange:1413292302050394153>', name: 'Orange Pack', code: 'orange', price: 8000 },
  { emoji: '<:pack_strawberry:1413292056830545970>', name: 'Strawberry Pack', code: 'strawberry', price: 10000 },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('View available card packs'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🛍️ Card Shop')
      .setDescription('Buy packs using /buy <pack>')
      .setColor('Purple');

    packs.forEach(pack => {
      embed.addFields(
        { name: `${pack.emoji} ${pack.name}`, value: `Code: ${pack.code}\nPrice: ${pack.price} <:berrycoin:1411737957081288724>` }
      );
    });

    await interaction.reply({ embeds: [embed] });
  }
};


