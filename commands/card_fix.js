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
    .setDescription('🛠️ ADMIN: Corrige datos o imagen de una carta ya existente.')
    .addStringOption(opt => 
      opt.setName('code') 
        .setDescription('El código EXACTO de la carta (Ej: SWJLT3)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(opt => opt.setName('grupo').setDescription('(Opcional) Nuevo nombre del grupo'))
    .addStringOption(opt => opt.setName('idol').setDescription('(Opcional) Nuevo nombre del idol'))
    .addStringOption(opt => opt.setName('era').setDescription('(Opcional) Nueva Era'))
    .addAttachmentOption(opt => opt.setName('imagen').setDescription('(Opcional) Nueva imagen (Sobrescribe la anterior)')),

  // --- AUTOCOMPLETADO ---
  async autocomplete(interaction) {
    // Seguridad extra: Si no es el dueño, no le mostramos ni las opciones
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
    // 1. Verificar Permisos (SOLO ID ESPECÍFICO)
    if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: '🚫 **Acceso Denegado:** Este comando es exclusivo para el Owner.', ephemeral: true });
    }

    const targetCode = interaction.options.getString('code').toUpperCase().trim();
    
    // Datos opcionales
    const newGroup = interaction.options.getString('grupo');
    const newIdol = interaction.options.getString('idol');
    const newEra = interaction.options.getString('era');
    const newImage = interaction.options.getAttachment('imagen');

    // Verificar que haya al menos un cambio
    if (!newGroup && !newIdol && !newEra && !newImage) {
        return interaction.reply({ content: '⚠️ No has puesto nada para cambiar. Rellena al menos un campo opcional (Grupo, Idol, Era o Imagen).', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // 2. Buscar la carta original
      const { data: originalCard, error: fetchError } = await supabase
        .from('base_cards')
        .select('*')
        .eq('card_code', targetCode)
        .single();

      if (fetchError || !originalCard) {
        return interaction.editReply(`❌ No se encontró ninguna carta con el código **${targetCode}**.`);
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

      // 4. Manejo de Imagen (Cloudinary)
      if (newImage) {
          const uploadResult = await cloudinary.uploader.upload(newImage.url, { 
              folder: 'photocards', 
              public_id: targetCode, 
              format: 'webp', 
              overwrite: true,
              invalidate: true 
          });

          // Parche de versión para evitar caché de Discord
          const freshUrl = `${uploadResult.secure_url}?v=${Date.now()}`;
          
          updates.image_url = freshUrl;
          changesLog.push(`🖼️ **Imagen reemplazada**`);
      }

      // 5. Actualizar Supabase
      const { error: updateError } = await supabase
        .from('base_cards')
        .update(updates)
        .eq('card_code', targetCode);

      if (updateError) throw updateError;

      // 6. Log al Historial
      await supabase.from('history_logs').insert({
          user_id: interaction.user.id,
          action_type: 'admin_fix',
          details: `Fix ${targetCode}: ${Object.keys(updates).join(', ')}`
      });

      // 7. Respuesta Visual
      const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle(`🛠️ Carta Corregida: ${targetCode}`)
        .setDescription(changesLog.join('\n'))
        .addFields(
            { 
                name: 'Datos actuales', 
                value: `**${updates.name || originalCard.name}**\n${updates.group_name || originalCard.group_name}\n${updates.era || originalCard.era}` 
            }
        )
        .setFooter({ text: `Editado por ${interaction.user.username}` })
        .setTimestamp();

      if (updates.image_url) {
          embed.setImage(updates.image_url);
      } else {
          embed.setThumbnail(originalCard.image_url);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en card_fix:', error);
      await interaction.editReply('❌ Ocurrió un error al intentar editar la carta en la base de datos.');
    }
  }
};
