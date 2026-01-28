const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const path = require('path'); // 👈 IMPORTANTE: Esto nos ayuda a encontrar el archivo

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
        .order('price', { ascending: true }); 

      if (error) {
        console.error('Error fetching shop:', error);
        return interaction.editReply('❌ Hubo un error al cargar la tienda.');
      }

      if (!packs || packs.length === 0) {
        return interaction.editReply('🏪 La tienda está vacía por el momento.');
      }

      // 2. Preparar la IMAGEN LOCAL (Ruta Absoluta / Blindada)
      // Esto le dice al bot: "Desde esta carpeta 'commands', sube un nivel (..) y busca shop.png"
      const imagePath = path.join(__dirname, '..', 'shop.png');
      const shopImage = new AttachmentBuilder(imagePath);

      // 3. Crear el Embed
      const embed = new EmbedBuilder()
        .setTitle('🛍️ Tienda de Cartas (Card Shop)')
        .setDescription(`Usa \`/buy pack:Nombre\` para comprar.`)
        .setColor('Purple') 
        // Aquí le decimos que use la imagen adjunta como thumbnail
        .setThumbnail('attachment://shop.png') 
        .setTimestamp();

      // 4. Agregar cada pack
      packs.forEach(pack => {
        const contentDesc = PACK_CONTENTS[pack.code] || '📦 Contenido sorpresa';

        embed.addFields({ 
            name: `${pack.emoji} __${pack.name}__`, 
            value: `💸 **Precio:** ${pack.price} ${moneyEmoji}\n🏷️ **Code:** \`${pack.code}\`\n\n**Incluye:**\n${contentDesc}`,
            inline: true 
        });
      });

      embed.setFooter({ text: 'Los precios pueden variar según eventos o demanda.' });

      // IMPORTANTE: Enviar el embed Y el archivo adjunto
      await interaction.editReply({ embeds: [embed], files: [shopImage] });

    } catch (err) {
      console.error('Error en shop:', err);
      // Si falla porque no encuentra la imagen, avisa
      if (err.code === 'ENOENT') {
          await interaction.editReply('❌ Error: No encuentro el archivo `shop.png` en la carpeta principal del bot.');
      } else {
          await interaction.editReply('❌ Ocurrió un error inesperado.');
      }
    }
  }
};
