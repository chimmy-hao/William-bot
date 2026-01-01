const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType 
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;

// Config Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Config Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const strawberryEmoji = '<:strawberrity:1411384728119939182>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('card_create')
    .setDescription('Managers: añade cartas nuevas con validación y vista previa.')
    .addStringOption(opt => opt.setName('id').setDescription('Base ID (e.g. WMO)').setRequired(true))
    .addStringOption(opt => opt.setName('group').setDescription('Group name').setRequired(true))
    .addStringOption(opt => opt.setName('idol').setDescription('Idol name').setRequired(true))
    .addStringOption(opt => opt.setName('era').setDescription('Album / Era').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image1').setDescription('Common Image').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image2').setDescription('Rare Image').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image3').setDescription('Legendary Image').setRequired(true))
    .addBooleanOption(opt => 
      opt.setName('en_espera')
      .setDescription('True = Guardar en Pool (Oculta). False/Vacío = Publicar YA.')
      .setRequired(true)
    ),

  async execute(interaction) {
    try {
      // 1. Diferir respuesta como efímera para el PREVIEW
      await interaction.deferReply({ ephemeral: true });

      // Verificar Roles
      const allowedRoles = ['1411356161063518228'];
      if (!allowedRoles.some(r => interaction.member.roles.cache.has(r))) {
        return interaction.editReply('❌ No tienes permisos.');
      }

      // Obtener datos
      const baseId = interaction.options.getString('id').toUpperCase();
      const group = interaction.options.getString('group');
      const idol = interaction.options.getString('idol');
      const era = interaction.options.getString('era');
      const sendToPool = interaction.options.getBoolean('en_espera') || false;
      const isActive = !sendToPool;
      
      const img1 = interaction.options.getAttachment('image1');
      const img2 = interaction.options.getAttachment('image2');
      const img3 = interaction.options.getAttachment('image3');

      // --- VALIDACIÓN DE DUPLICADOS ---
      // Verificamos si la carta #1 de este ID ya existe en la base de datos
      const { data: existingCard, error: searchError } = await supabase
        .from('base_cards')
        .select('card_code')
        .eq('card_code', `${baseId}1`)
        .maybeSingle();

      if (searchError) {
        console.error('Error buscando duplicados:', searchError);
        return interaction.editReply('❌ Hubo un error verificando la base de datos. Intenta de nuevo.');
      }

      if (existingCard) {
        // Si entra aquí, es que YA EXISTE ese ID
        return interaction.editReply(`⛔ **Error de Validación:**\nEl ID \`${baseId}\` ya está registrado en el sistema (se detectó \`${baseId}1\`).\nPor favor, usa un ID diferente.`);
      }
      // --------------------------------

      // --- PASO 1: VISTA PREVIA (PREVIEW) ---
      
      const previewEmbed = new EmbedBuilder()
        .setColor('#f1c40f') 
        .setTitle('🚧 Vista Previa: Confirmar Carga')
        .setDescription(`El ID **${baseId}** está disponible. Revisa los datos:`)
        .addFields(
          { name: 'Base ID', value: baseId, inline: true },
          { name: 'Idol', value: idol, inline: true },
          { name: 'Group', value: group, inline: true },
          { name: 'Era', value: era, inline: true },
          { name: 'Estado', value: sendToPool ? '🔒 Pool (Oculta)' : '✅ Publicar Directamente', inline: true }
        )
        .setImage(img1.url)
        .setFooter({ text: 'Revisa las imágenes. Si todo está bien, presiona Confirmar.' });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_upload').setLabel('Confirmar y Subir').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('cancel_upload').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
      );

      // Enviamos el preview
      const previewMsg = await interaction.editReply({ 
        content: '**Revisión de datos requerida**',
        embeds: [previewEmbed], 
        components: [buttons] 
      });

      // --- PASO 2: ESPERAR CONFIRMACIÓN ---
      
      const collector = previewMsg.createMessageComponentCollector({ 
        componentType: ComponentType.Button, 
        time: 60000 
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: 'No puedes usar estos botones.', ephemeral: true });
        }

        if (i.customId === 'cancel_upload') {
          await i.update({ content: '❌ **Operación cancelada.** No se guardó nada.', embeds: [], components: [] });
          return;
        }

        if (i.customId === 'confirm_upload') {
          await i.update({ content: '⏳ **Procesando subida... por favor espera.**', components: [] });

          try {
             // --- LÓGICA DE SUBIDA ---
            
            await supabase.from('users').upsert([{ user_id: interaction.user.id }], { onConflict: 'user_id' });

            const uploadWebp = async (url, pid) => cloudinary.uploader.upload(url, { folder: 'photocards', public_id: pid, format: 'webp', overwrite: true });
            
            const up1 = await uploadWebp(img1.url, `${baseId}1`);
            const up2 = await uploadWebp(img2.url, `${baseId}2`);
            const up3 = await uploadWebp(img3.url, `${baseId}3`);

            const cards = [
              { card_code: `${baseId}1`, name: idol, group_name: group, image_url: up1.secure_url, rarity: 'common', rarity_level: 1, era, is_active: isActive },
              { card_code: `${baseId}2`, name: idol, group_name: group, image_url: up2.secure_url, rarity: 'rare', rarity_level: 2, era, is_active: isActive },
              { card_code: `${baseId}3`, name: idol, group_name: group, image_url: up3.secure_url, rarity: 'legendary', rarity_level: 3, era, is_active: isActive }
            ];

            const { error } = await supabase.from('base_cards').insert(cards);
            if (error) throw new Error(error.message);

            // Contador Staff
            const { data: userData } = await supabase.from('users').select('pending_creates').eq('user_id', interaction.user.id).single();
            const currentCreates = userData?.pending_creates || 0;
            await supabase.from('users').update({ pending_creates: currentCreates + 3 }).eq('user_id', interaction.user.id);

            // Anuncio Público (Canal de noticias)
            const announcementEmbed = new EmbedBuilder()
              .setColor('#2c2d31')
              .setTitle('✨ New photocards have been added!')
              .setDescription(
                `**${idol} — ${group}**\nEra: ${era}\n\n` +
                `${strawberryEmoji} | ${baseId}1\n` +
                `${strawberryEmoji}${strawberryEmoji} | ${baseId}2\n` +
                `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji} | ${baseId}3\n`
              )
              .setFooter({ text: `added by: ${interaction.user.username}` });

            try {
              const channel = await interaction.client.channels.fetch('1411784592192573601');
              if (channel && isActive) await channel.send({ embeds: [announcementEmbed] });
            } catch (e) { console.error('Error enviando anuncio:', e); }

            // --- FINALIZACIÓN ---

            // 1. Mensaje efímero final
            await interaction.editReply({ content: '✅ **Proceso finalizado con éxito.**', embeds: [] });

            // 2. LOG PÚBLICO (Constancia)
            const logEmbed = new EmbedBuilder()
              .setColor(isActive ? '#00ff00' : '#ffa500')
              .setTitle('📂 Registro de Carga de Cartas')
              .setDescription(`**Manager:** <@${interaction.user.id}>\n**Fecha:** <t:${Math.floor(Date.now() / 1000)}:f>`)
              .addFields(
                { name: 'Idol / Grupo', value: `${idol} - ${group}`, inline: true },
                { name: 'Era', value: era, inline: true },
                { name: 'Base ID', value: `\`${baseId}\``, inline: true },
                { name: 'Destino', value: isActive ? 'Publicado 📡' : 'Pool (En espera) 🔒', inline: true },
                { name: 'Puntos Staff', value: '+3 creates', inline: true }
              )
              .setThumbnail(up1.secure_url)
              .setFooter({ text: 'Sistema de Carga • Log' });

            await interaction.channel.send({ embeds: [logEmbed] });

          } catch (err) {
            console.error(err);
            await interaction.editReply({ content: `❌ **Error Crítico:** ${err.message}` });
          }
        }
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          interaction.editReply({ content: '⏰ **Tiempo agotado.**', embeds: [], components: [] });
        }
      });

    } catch (err) {
      console.error(err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
      } else {
        await interaction.editReply({ content: `❌ Error: ${err.message}` });
      }
    }
  },
};
