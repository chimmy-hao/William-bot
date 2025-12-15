const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view')
    .setDescription('📸 Genera una imagen con tus cartas (Grid View)')
    .addStringOption(option => 
      option.setName('codes')
            .setDescription('Códigos separados por espacios (Máx 9)')
            .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const inputCodes = interaction.options.getString('codes');

    // 1. Limpiar códigos
    const codes = inputCodes
      .split(/[\s,]+/)
      .filter(c => c.length > 0)
      .slice(0, 9);

    if (codes.length === 0) return interaction.reply({ content: '❌ Escribe al menos un código.', ephemeral: true });

    try {
      await interaction.deferReply();

      // 2. Buscar cartas en DB
      const { data: userCards, error } = await supabase
        .from('user_cards')
        .select(`
          unique_card_id,
          base_cards (image_url, name)
        `)
        .in('unique_card_id', codes)
        .eq('user_id', userId);

      if (error) {
        console.error('Error DB:', error);
        return interaction.editReply('❌ Error de conexión al buscar las cartas.');
      }

      // === VALIDACIÓN ESTRICTA (NUEVA) ===
      // Creamos una lista de los IDs que SÍ encontramos
      const foundIds = userCards ? userCards.map(c => c.unique_card_id) : [];

      // Filtramos cuáles de los códigos que escribiste NO aparecieron en la búsqueda
      const missingCodes = codes.filter(code => !foundIds.includes(code));

      // Si hay códigos faltantes, cancelamos todo y mostramos error
      if (missingCodes.length > 0) {
        return interaction.editReply({
          content: `❌ **Error:** No encontré las siguientes cartas (o están mal escritas/no son tuyas):\n\`${missingCodes.join(', ')}\``
        });
      }
      
      if (userCards.length === 0) {
        return interaction.editReply('❌ No se encontró ninguna carta válida.');
      }
      // ===================================

      // 3. CONFIGURACIÓN DEL GRID (DISEÑO MINIMALISTA)
      const cardWidth = 200;
      const cardHeight = 300;
      const gap = 20;
      const textSpace = 30; 
      const columns = 3;

      const rows = Math.ceil(userCards.length / columns);
      const actualCols = Math.min(userCards.length, columns);
      
      const finalWidth = (cardWidth * actualCols) + (gap * (actualCols + 1));
      const finalHeight = (cardHeight + textSpace) * rows + (gap * (rows + 1));

      const canvas = createCanvas(finalWidth, finalHeight);
      const ctx = canvas.getContext('2d');

      // 4. CARGAR IMÁGENES
      const loadedImages = await Promise.all(
        userCards.map(async (card) => {
          try {
            const img = await loadImage(card.base_cards.image_url);
            return { img, ...card };
          } catch (e) {
            return null;
          }
        })
      );

      const validCards = loadedImages.filter(c => c !== null);

      // 5. DIBUJAR
      for (let i = 0; i < validCards.length; i++) {
        const card = validCards[i];
        
        const col = i % columns;
        const row = Math.floor(i / columns);

        const x = gap + (col * (cardWidth + gap));
        const y = gap + (row * (cardHeight + textSpace + gap));

        // -- IMAGEN CON BORDES --
        const radius = 15;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + cardWidth - radius, y);
        ctx.quadraticCurveTo(x + cardWidth, y, x + cardWidth, y + radius);
        ctx.lineTo(x + cardWidth, y + cardHeight - radius);
        ctx.quadraticCurveTo(x + cardWidth, y + cardHeight, x + cardWidth - radius, y + cardHeight);
        ctx.lineTo(x + radius, y + cardHeight);
        ctx.quadraticCurveTo(x, y + cardHeight, x, y + cardHeight - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.clip();
        
        ctx.drawImage(card.img, x, y, cardWidth, cardHeight);
        ctx.restore();

        // -- TEXTO --
        const prefix = card.unique_card_id.split('.')[0];

        ctx.font = '16px Arial'; 
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 3;
        ctx.lineWidth = 1;

        const textX = x + (cardWidth / 2);
        const textY = y + cardHeight + 20;
        
        ctx.fillText(prefix, textX, textY);
        
        ctx.shadowBlur = 0;
      }

      const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'collection-view.png' });

      await interaction.editReply({ 
        content: `📸 Vista de colección de <@${userId}>`, 
        files: [attachment] 
      });

    } catch (err) {
      console.error('Error en view:', err);
      await interaction.editReply('❌ Error generando la imagen.');
    }
  }
};

