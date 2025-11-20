const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas'); // Librería de imagen

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

    // 1. Limpiar códigos (Máximo 9 para que quede un grid de 3x3 bonito)
    const codes = inputCodes
      .split(/[\s,]+/)
      .filter(c => c.length > 0)
      .slice(0, 9);

    if (codes.length === 0) return interaction.reply({ content: '❌ Escribe al menos un código.', ephemeral: true });

    try {
      await interaction.deferReply();

      // 2. Buscar cartas en DB (Solo las tuyas)
      const { data: userCards, error } = await supabase
        .from('user_cards')
        .select(`
          unique_card_id,
          base_cards (image_url, name)
        `)
        .in('unique_card_id', codes)
        .eq('user_id', userId);

      if (error || !userCards || userCards.length === 0) {
        return interaction.editReply('❌ No encontré cartas tuyas con esos códigos.');
      }

      // 3. CONFIGURACIÓN DEL GRID (CANVAS)
      const cardWidth = 200;   // Ancho de cada carta
      const cardHeight = 300;  // Alto de cada carta
      const gap = 20;          // Espacio entre cartas
      const textSpace = 40;    // Espacio abajo para el texto
      const columns = 3;       // Máximo 3 columnas

      // Calcular filas necesarias
      const rows = Math.ceil(userCards.length / columns);

      // Calcular tamaño total del lienzo
      const canvasWidth = (cardWidth * columns) + (gap * (columns + 1)); 
      // Ancho ajustado si hay menos de 3 cartas
      const actualCols = Math.min(userCards.length, columns);
      const finalWidth = (cardWidth * actualCols) + (gap * (actualCols + 1));
      
      const finalHeight = (cardHeight + textSpace) * rows + (gap * (rows + 1));

      // Crear lienzo
      const canvas = createCanvas(finalWidth, finalHeight);
      const ctx = canvas.getContext('2d');

      // Fondo (Gris oscuro Discord o transparente)
      // ctx.fillStyle = '#2b2d31'; 
      // ctx.fillRect(0, 0, canvas.width, canvas.height); 

      // 4. DIBUJAR CARTAS
      // Cargamos todas las imágenes en paralelo para que sea rápido
      const loadedImages = await Promise.all(
        userCards.map(async (card) => {
          try {
            const img = await loadImage(card.base_cards.image_url);
            return { img, ...card };
          } catch (e) {
            console.error('Error cargando imagen:', e);
            return null;
          }
        })
      );

      // Filtrar si alguna imagen falló al cargar
      const validCards = loadedImages.filter(c => c !== null);

      for (let i = 0; i < validCards.length; i++) {
        const card = validCards[i];
        
        // Calcular posición X e Y
        const col = i % columns;
        const row = Math.floor(i / columns);

        const x = gap + (col * (cardWidth + gap));
        const y = gap + (row * (cardHeight + textSpace + gap));

        // --- DIBUJAR IMAGEN CON BORDES REDONDEADOS ---
        const radius = 15; // Radio de curvatura
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
        ctx.clip(); // Recortar lo que se dibuje después dentro de esta forma
        
        ctx.drawImage(card.img, x, y, cardWidth, cardHeight);
        ctx.restore(); // Restaurar para dibujar texto sin recorte

        // --- DIBUJAR TEXTO (PREFIJO) ---
        // Extraer prefijo: "HMN3.1234" -> "HMN3"
        const prefix = card.unique_card_id.split('.')[0];
        const shinySuffix = "✨ " + prefix; // Le agregué una estrellita estética

        ctx.font = 'bold 20px Sans';
        ctx.fillStyle = '#ffffff'; // Color blanco
        ctx.textAlign = 'center';
        
        // Sombra del texto para que se lea mejor
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.lineWidth = 2;

        // Dibujar texto centrado debajo de la carta
        const textX = x + (cardWidth / 2);
        const textY = y + cardHeight + 25; // 25px abajo de la imagen
        
        ctx.fillText(shinySuffix, textX, textY);
        
        // Resetear sombra
        ctx.shadowBlur = 0;
      }

      // 5. ENVIAR
      const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'collection-view.png' });

      await interaction.editReply({ 
        content: `📸 Vista de colección de <@${userId}>`, 
        files: [attachment] 
      });

    } catch (err) {
      console.error('Error en view:', err);
      await interaction.editReply('❌ Error generando la imagen. Verifica que los códigos sean correctos.');
    }
  }
};
