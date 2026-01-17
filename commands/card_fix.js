const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;

// --- CONFIGURACIÓN ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Configuración de Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ID ÚNICO PERMITIDO
const OWNER_ID = '1411356161063518228';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('card_fix')
    .setDescription('🛠️ ADMIN: Corrige datos, imagen o evento de una carta.')
    .addStringOption(opt => 
      opt.setName('code') 
        .setDescription('El código EXACTO de la carta (Ej: WMO-IG1)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(opt => opt.setName('grupo').setDescription('(Opcional) Nuevo nombre del grupo'))
    .addStringOption(opt => opt.setName('idol').setDescription('(Opcional) Nuevo nombre del idol'))
    .addStringOption(opt => opt.setName('era').setDescription('(Opcional) Nueva Era visual'))
    // NUEVA OPCIÓN: EVENTO
    .addStringOption(opt => opt.setName('evento').setDescription('(Opcional) Nuevo tag de Evento (ej: verano, insta). Escribe "borrar" para quitar.'))
    .addAttachmentOption(opt => opt.setName('imagen').setDescription('(Opcional) Nueva imagen (Sobrescribe la anterior)')),

  // --- AUTOCOMPLETADO ---
  async autocomplete(interaction) {
    if (interaction.user.id !== OWNER_ID) return interaction.respond([]);

    const focusedValue = interaction.options.getFocused();
    
    const { data: cards } = await supabase
        .from('base_cards')
        .select('card_code, name')
        .ilike('card_code', `%${focusedValue}%`)
        .limit(25);

    if (!cards) return interaction.respond([]);

    await interaction.respond(
        cards.map(c => ({ name: `${c.card_code} (${c.name})`, value: c.card_code }))
    );
  },

  // --- EJECUCIÓN ---
  async execute(interaction) {
    // 1. Verificar Permisos
    if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: '🚫 **Acceso Denegado:** Exclusivo para el Owner.', ephemeral: true });
    }

    const targetCode = interaction.options.getString('code').toUpperCase().trim();
    
    // Datos opcionales
    const newGroup = interaction.options.getString('grupo');
    const newIdol = interaction.options.getString('idol');
    const newEra = interaction.options.getString('era');
    const newEvent = interaction.options.getString('evento'); // Nuevo
    const newImage = interaction.options.getAttachment('imagen');

    // Verificar que haya cambios
    if (!newGroup && !newIdol && !newEra && !newImage && !newEvent) {
        return interaction.reply({ content: '⚠️ Debes rellenar al menos un campo para editar.', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // 2. Buscar carta original
      const { data: originalCard, error: fetchError } = await supabase
        .from('base_cards')
        .select('*')
        .eq('card_code', targetCode)
        .single();

      if (fetchError || !originalCard) {
        return interaction.editReply(`❌ No se encontró la carta **${targetCode}**.`);
      }

      // 3. Preparar actualizaciones
      const updates = {};
      const changesLog = [];

      if (newGroup) {
          updates.group_name = newGroup;
          changesLog.push(`📂 Grupo: ${originalCard.group_name} ➔ **${newGroup}**`);
      }
      if (newIdol) {
          updates.name = newIdol;
          changesLog.push(`👤 Idol: ${originalCard.name} ➔ **${newIdol}**`);
      }
      if (newEra) {
          updates.era = newEra;
          changesLog.push(`💿 Era: ${originalCard.era} ➔ **${newEra}**`);
      }
      
      // Lógica para Evento
      if (newEvent) {
          const lowerEvent = newEvent.toLowerCase();
          // Si escribe "borrar", "null" o "quitar", limpiamos el evento
          if (['borrar', 'null', 'quitar', 'ninguno'].includes(lowerEvent)) {
              updates.event_type = null;
              changesLog.push(`🎉 Evento: ${originalCard.event_type || 'Ninguno'} ➔ **(Eliminado)**`);
          } else {
              updates.event_type = lowerEvent;
              changesLog.push(`🎉 Evento: ${originalCard.event_type || 'Ninguno'} ➔ **${lowerEvent}**`);
          }
      }

      // 4. Manejo de Imagen
      if (newImage) {
          const uploadResult = await cloudinary.uploader.upload(newImage.url, { 
              folder: originalCard.event_type ? `photocards/${originalCard.event_type}` : 'photocards', 
              public_id: targetCode, 
              format: 'webp', 
              overwrite: true,
              invalidate: true 
          });

          const freshUrl = `${uploadResult.secure_url}?v=${Date.now()}`;
          updates.image_url = freshUrl;
          changesLog.push(`🖼️ **Imagen actualizada**`);
      }

      // 5. Actualizar Supabase
      const { error: updateError } = await supabase
        .from('base_cards')
        .update(updates)
        .eq('card_code', targetCode);

      if (updateError) throw updateError;

      // 6. Log Historial
      await supabase.from('history_logs').insert({
          user_id: interaction.user.id,
          action_type: 'admin_fix',
          details: `Fix ${targetCode}: ${Object.keys(updates).join(', ')}`
      });

      // 7. Respuesta
      const embed = new EmbedBuilder()
        .setColor('#e67e22') // Naranja de "reparación"
        .setTitle(`🛠️ Carta Actualizada: ${targetCode}`)
        .setDescription(changesLog.join('\n'))
        .addFields({ 
            name: 'Estado Actual', 
            value: `**${updates.name || originalCard.name}**\n${updates.group_name || originalCard.group_name}\nEra: ${updates.era || originalCard.era}\nEvento: \`${updates.event_type !== undefined ? updates.event_type : (originalCard.event_type || 'Ninguno')}\`` 
        })
        .setFooter({ text: `Admin: ${interaction.user.username}` })
        .setTimestamp();

      if (updates.image_url) {
          embed.setImage(updates.image_url);
      } else {
          embed.setThumbnail(originalCard.image_url);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en card_fix:', error);
      await interaction.editReply('❌ Error al editar la carta.');
    }
  }
};
