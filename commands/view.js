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
            .setDescription('Códigos separados por espacios (Ej: CWJL2.4957)')
            .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const inputCodes = interaction.options.getString('codes');

    // 1. Limpiar y separar códigos
    // Esto separa por espacios o comas y elimina vacíos
    const codesRaw = inputCodes.split(/[\s,]+/).filter(c => c.length > 0);
    
    // Eliminamos duplicados por si el usuario pone el mismo código dos veces
    const codes = [...new Set(codesRaw)].slice(0, 9); // Máximo 9 para que entre en la imagen

    if (codes.length === 0) return interaction.reply({ content: '❌ Escribe al menos un código.', ephemeral: true });

    try {
      await interaction.deferReply();

      // 2. Buscar cartas en DB
      // Buscamos EXACTAMENTE esos IDs en el inventario del usuario
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

      // === 3. VALIDACIÓN ESTRICTA (LO QUE PEDISTE) ===
      
      // Lista de IDs que la base de datos encontró realmente
      // (Si escribiste bien el código y es tuyo, estará aquí)
      const foundIds = userCards ? userCards.map(c => c.unique_card_id) : [];

      // Filtramos: ¿Qué códigos de los que escribiste NO aparecieron en la búsqueda?
      const invalidCodes = codes.filter(code => !foundIds.includes(code));

      // Si hay al menos un código inválido, paramos todo.
      if (invalidCodes.length > 0) {
        // Unimos los códigos erróneos con comas para mostrarlos
        const listaErrores = invalidCodes.map(c => `\`${c}\``).join(', ');
        
        return interaction.editReply({
          content: `❌ **Código mal ingresado o no te pertenece:**\nLos siguientes códigos no coinciden con tu inventario:\n👉 ${listaErrores}`
        });
      }

      if (userCards.length === 0) {
        return interaction.editReply('❌ No se encontró ninguna carta válida.');
      }
      // ===============================================

      // 4. CONFIGURACIÓN DEL GRID (DISEÑO)
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

      // 5. CARGAR IMÁGENES
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

      // 6. DIBUJAR
      for (let i = 0; i < validCards.length; i++) {
        const card = validCards[i];
        
        const col = i % columns;
        const row = Math.floor(i / columns);

        const x = gap + (col * (cardWidth + gap));
        const y = gap + (row * (cardHeight + textSpace + gap));

        // -- Borde Redondeado --
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

        // -- Texto del ID --
        const prefix = card.unique_card_id.split('.')[0];
        // O si prefieres ver el código completo (incluyendo los 4 números), usa:
        // const fullCode = card.unique_card_id;

        ctx.font = '16px Arial'; 
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 3;
        ctx.lineWidth = 1;

        const textX = x + (cardWidth / 2);
        const textY = y + cardHeight + 20;
        
        // Aquí muestro el prefijo (ej: CWJL2), si quieres todo el código cambia 'prefix' por card.unique_card_id
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

