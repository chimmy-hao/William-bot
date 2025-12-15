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
    // Separa por espacios o comas, quita vacíos y limita a 9 cartas
    const codesRaw = inputCodes.split(/[\s,]+/).filter(c => c.length > 0);
    const codes = [...new Set(codesRaw)].slice(0, 9); 

    // Validación básica inicial (Efímera)
    if (codes.length === 0) {
      return interaction.reply({ content: '❌ Escribe al menos un código.', ephemeral: true });
    }

    try {
      // ⚠️ NOTA IMPORTANTE:
      // No usamos 'deferReply' aquí todavía. Primero verificamos si hay errores.
      // Así, si hay error, el mensaje puede ser invisible (ephemeral).

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
        return interaction.reply({ content: '❌ Error de conexión al buscar las cartas.', ephemeral: true });
      }

      // === 3. VALIDACIÓN ESTRICTA Y EFÍMERA ===
      const foundIds = userCards ? userCards.map(c => c.unique_card_id) : [];
      
      // Filtramos qué códigos de los que escribiste NO aparecieron
      const invalidCodes = codes.filter(code => !foundIds.includes(code));

      // Si hay errores, respondemos SOLO AL USUARIO (Ephemeral) y cancelamos
      if (invalidCodes.length > 0) {
        const listaErrores = invalidCodes.map(c => `\`${c}\``).join(', ');
        
        return interaction.reply({
          content: `❌ **Código incorrecto o no te pertenece:**\nLos siguientes códigos no coinciden con tu inventario:\n👉 ${listaErrores}`,
          ephemeral: true 
        });
      }

      if (userCards.length === 0) {
        return interaction.reply({ content: '❌ No se encontró ninguna carta válida.', ephemeral: true });
      }
      // ===============================================

      // 4. CONFIRMACIÓN PÚBLICA
      // Como ya pasamos las validaciones, ahora sí "pensamos" públicamente para generar la imagen
      await interaction.deferReply(); 

      // 5. CONFIGURACIÓN DEL CANVAS
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

      // 6. CARGAR IMÁGENES
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

      // 7. DIBUJAR
      for (let i = 0; i < validCards.length; i++) {
        const card = validCards[i];
        
        const col = i % columns;
        const row = Math.floor(i / columns);

        const x = gap + (col * (cardWidth + gap));
        const y = gap + (row * (cardHeight + textSpace + gap));

        // -- DIBUJO CON BORDE REDONDEADO --
        const radius = 15; // Radio del borde
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

        // -- TEXTO (Código) --
        const prefix = card.unique_card_id.split('.')[0];

        ctx.font = '16px Arial'; 
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        
        // Sombra para que se lea mejor
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 3;
        ctx.lineWidth = 1;

        const textX = x + (cardWidth / 2);
        const textY = y + cardHeight + 20;
        
        ctx.fillText(prefix, textX, textY);
        
        ctx.shadowBlur = 0;
      }

      const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'collection-view.png' });

      // 8. ENVIAR IMAGEN PÚBLICA
      // Usamos editReply porque en el paso 4 usamos deferReply
      await interaction.editReply({ 
        content: `📸 Vista de colección de <@${userId}>`, 
        files: [attachment] 
      });

    } catch (err) {
      console.error('Error en view:', err);
      // Manejo de error inteligente:
      // Si falló DESPUÉS del defer (paso 4), editamos. Si fue ANTES, respondemos efímero.
      if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: '❌ Ocurrió un error al generar la imagen.' }).catch(() => {});
      } else {
          await interaction.reply({ content: '❌ Ocurrió un error interno.', ephemeral: true }).catch(() => {});
      }
    }
  }
};
