const { SlashCommandBuilder, EmbedBuilder } = require('discord.js'); 
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- EMOJIS ---
const moneyEmoji = '<:berrycoin:1411737957081288724>';
const strawberrity = '<:strawberrity:1440934894443429909>'; 
const strawvent = '<:strawvent:1462665407218585620>';       

// --- DICCIONARIO DE CONTENIDOS ---
const PACK_CONTENTS = {
  'banana': `• **4x** Rareza 1 ${strawberrity}\n• **1x** Rareza 2 ${strawberrity}${strawberrity}`,
  'grape':  `• **2x** Rareza 1 ${strawberrity}\n• **3x** Rareza 2 ${strawberrity}${strawberrity}`,
  'kiwi':   `• **2x** Rareza 1 ${strawberrity}\n• **2x** Rareza 2 ${strawberrity}${strawberrity}\n• **1x** Rareza 3 ${strawberrity}${strawberrity}${strawberrity}`,
  'orange': `• **5x** Aleatorias\n✨ **Garantizado:** Mismo Grupo`,
  'strawberry': `• **5x** Aleatorias\n✨ **Garantizado:** Mismo Idol`,
  'drops':  `3 cartas de evento ${strawvent}${strawvent}`
};

// 👇 Link directo de tu emoji <:shop:1466079485945188372>
const SHOP_IMAGE_URL = 'https://cdn.discordapp.com/emojis/1466079485945188372.png?size=1024';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('🛍️ Ver la tienda de packs de cartas'),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      // 1. Consultar los packs
      const { data: packs, error } = await supabase
        .from('packs')
        .select('*')
        .order('price', { ascending: true }); 

      if (error) {
        console.error('Error fetching shop:', error);
        return interaction.editReply('❌ Hubo un error al cargar la tienda.');
      }

      if (!packs || packs.length === 0) {
        return interaction.editReply('🏪 La tienda está vacía por el momento.');
      }

      // 2. Crear el Embed
      const embed = new EmbedBuilder()
        .setTitle('🛍️ Tienda de Cartas (Card Shop)')
        .setDescription(`Usa \`/buy pack:Nombre\` para comprar.`)
        .setColor('Purple') 
        .setThumbnail(SHOP_IMAGE_URL) // 👈 Aquí se verá tu emoji en grande
        .setTimestamp();

      // 3. Agregar cada pack
      packs.forEach(pack => {
        const contentDesc = PACK_CONTENTS[pack.code] || '📦 Contenido sorpresa';

        embed.addFields({ 
            name: `${pack.emoji} __${pack.name}__`, 
            value: `💸 **Precio:** ${pack.price} ${moneyEmoji}\n🏷️ **Code:** \`${pack.code}\`\n\n**Incluye:**\n${contentDesc}`,
            inline: true 
        });
      });

      embed.setFooter({ text: 'Los precios pueden variar según eventos o demanda.' });

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error en shop:', err);
      await interaction.editReply('❌ Ocurrió un error inesperado.');
    }
  }
};
