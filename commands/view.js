const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const CANVAS_CONFIG = {
    w: 642,
    h: 1032
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view')
    .setDescription('📸 Genera una imagen con tus cartas (1 carta = Detalle | Varias = Grid)')
    .addStringOption(option => 
      option.setName('codes')
            .setDescription('Códigos separados por espacios (Ej: CWJL2.4957)')
            .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const inputCodes = interaction.options.getString('codes');

    // 1. Limpiar y separar códigos
    const codesRaw = inputCodes.split(/[\s,]+/).filter(c => c.length > 0);
    const codes = [...new Set(codesRaw)].slice(0, 9); 

    if (codes.length === 0) {
      return interaction.reply({ content: '❌ Escribe al menos un código.', ephemeral: true });
    }

    try {
      // 2. Buscar cartas en DB
      const { data: userCards, error } = await supabase
        .from('user_cards')
        .select(`
          unique_card_id,
          rarity,
          created_at,
          base_cards (image_url, name, group_name, era, creator),
          holders!equipped_holder_id (code, image_url, name, emoji, creator_id)
        `)
        .in('unique_card_id', codes)
        .eq('user_id', userId);

      if (error) {
        console.error('Error DB:', error);
        return interaction.reply({ content: '❌ Error de conexión al buscar las cartas.', ephemeral: true });
      }

      // 3. VALIDACIÓN
      const foundIds = userCards ? userCards.map(c => c.unique_card_id) : [];
      const invalidCodes = codes.filter(code => !foundIds.includes(code));

      if (invalidCodes.length > 0) {
        const listaErrores = invalidCodes.map(c => `\`${c}\``).join(', ');
        return interaction.reply({
          content: `❌ **Código incorrecto o no te pertenece:**\nLos siguientes códigos no coinciden con tu inventario:\n👉 ${listaErrores}`,
          ephemeral: true 
        });
      }

      if (!userCards || userCards.length === 0) {
        return interaction.reply({ content: '❌ No se encontró ninguna carta válida.', ephemeral: true });
      }

      // 4. CONFIRMACIÓN PÚBLICA
      await interaction.deferReply(); 

      // =========================================================
      // 🅰️ MODO SINGLE (MODIFICADO)
      // =========================================================
      if (userCards.length === 1) {
          const card = userCards[0];
          const holder = card.holders; 
          const base = card.base_cards;

          // Canvas
          const canvas = createCanvas(CANVAS_CONFIG.w, CANVAS_CONFIG.h);
          const ctx = canvas.getContext('2d');

          // Dibujar Carta
          try {
              const cardImg = await loadImage(base.image_url);
              ctx.drawImage(cardImg, 0, 0, CANVAS_CONFIG.w, CANVAS_CONFIG.h);
          } catch (e) { console.error("Error img carta:", e); }

          // Dibujar Holder
          if (holder && holder.image_url) {
              try {
                  const holderImg = await loadImage(holder.image_url);
                  ctx.drawImage(holderImg, 0, 0, CANVAS_CONFIG.w, CANVAS_CONFIG.h);
              } catch (e) { console.error("Error img holder:", e); }
          }

          const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: `card-${card.unique_card_id}.png` });

          // --- CONSTRUCCIÓN DEL EMBED ---
          const date = new Date(card.created_at).toLocaleDateString('es-ES');
          const cardCreator = base.creator ? `@${base.creator}` : 'System';
          
          // 1. Título DINÁMICO: [Nombre] del grupo [Grupo] era [Era]
          // Usamos 'base.name' que viene de la DB (el nombre del artista/personaje)
          const titulo = `${base.name} del grupo ${base.group_name} era ${base.era}`;

          // 2. Descripción (Solo rareza, ID, fecha y creador)
          const description = `${card.rarity} - \`${card.unique_card_id}\`\nDropped at ${date}, Made by ${cardCreator}.`;

          const embed = new EmbedBuilder()
              .setColor(holder ? '#9b59b6' : '#2ecc71')
              .setTitle(titulo) // Aquí se aplica el título nuevo
              .setDescription(description)
              .setImage(`attachment://card-${card.unique_card_id}.png`)
              .setFooter({ text: `Owner: ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

          // 3. Detalles del Holder (Si existe)
          if (holder) {
              const detallesHolder = `Card holder \`${holder.code}\`: ${holder.emoji} ${holder.name}\n\`${holder.code}\` Made by <@${holder.creator_id}>`;
              
              embed.addFields({ 
                  name: 'Detalles', 
                  value: detallesHolder, 
                  inline: false 
              });
          }

          return interaction.editReply({ embeds: [embed], files: [attachment] });
      }

      // =========================================================
      // 🅱️ MODO GRID (MULTIVIEW) - SIN CAMBIOS
      // =========================================================
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

      for (let i = 0; i < validCards.length; i++) {
        const card = validCards[i];
        
        const col = i % columns;
        const row = Math.floor(i / columns);

        const x = gap + (col * (cardWidth + gap));
        const y = gap + (row * (cardHeight + textSpace + gap));

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
      if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: '❌ Ocurrió un error al generar la imagen.' }).catch(() => {});
      } else {
          await interaction.reply({ content: '❌ Ocurrió un error interno.', ephemeral: true }).catch(() => {});
    }
  }
};



