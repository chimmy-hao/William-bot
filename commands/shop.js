const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const moneyEmoji = '<:berrycoin:1411737957081288724>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('🛍️ Ver la tienda de packs de cartas'),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      // 1. Consultar los packs disponibles en la Base de Datos
      const { data: packs, error } = await supabase
        .from('packs')
        .select('*')
        .order('price', { ascending: true }); // Ordenar del más barato al más caro

      if (error) {
        console.error('Error fetching shop:', error);
        return interaction.editReply('❌ Hubo un error al cargar la tienda.');
      }

      if (!packs || packs.length === 0) {
        return interaction.editReply('🏪 La tienda está vacía por el momento.');
      }

      // 2. Crear el Embed dinámico
      const embed = new EmbedBuilder()
        .setTitle('🛍️ Tienda de Cartas (Card Shop)')
        .setDescription(`Usa \`/buy pack:Nombre\` para comprar.\nLos precios y packs se actualizan automáticamente.`)
        .setColor('Purple')
        .setTimestamp();

      // 3. Agregar cada pack de la base de datos a la lista
      packs.forEach(pack => {
        embed.addFields({ 
            name: `${pack.emoji} ${pack.name}`, 
            value: `Precio: **${pack.price}** ${moneyEmoji}\nCode: \`${pack.code}\``,
            inline: true 
        });
      });

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error en shop:', err);
      await interaction.editReply('❌ Ocurrió un error inesperado.');
    }
  }
};
