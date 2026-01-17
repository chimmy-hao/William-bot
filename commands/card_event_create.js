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

// --- CONFIGURACIÓN ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const ANNOUNCEMENT_CHANNEL_ID = '1411784592192573601'; // ID del canal de anuncios

// TU EMOJI PERSONALIZADO
const strawberryEmoji = '<:strawberrity:1440934894443429909>';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Roles permitidos
const ALLOWED_ROLES = ['1412852141197885464', '1411356161063518228'];

// Función helper
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('card_event_create')
    .setDescription('🎉 Staff: Sube carta para CUALQUIER evento (Rareza 2)')
    .setDefaultMemberPermissions(0)
    .addStringOption(opt => opt.setName('id').setDescription('Código único (ej: WMO-SUM1)').setRequired(true))
    .addStringOption(opt => opt.setName('grupo').setDescription('Nombre del Grupo').setRequired(true))
    .addStringOption(opt => opt.setName('artista').setDescription('Nombre del Idol').setRequired(true))
    .addStringOption(opt => 
        opt.setName('evento')
           .setDescription('Nombre del evento (Autocompletado)')
           .setRequired(true)
           .setAutocomplete(true)
    )
    .addAttachmentOption(opt => opt.setName('imagen').setDescription('Foto de la carta').setRequired(true))
    .addBooleanOption(opt => 
        opt.setName('reclamar_autoria')
           .setDescription('¿Hiciste tú la carta? True = Tu nombre. False/Vacío = William System.')
           .setRequired(false)
    ),

  // --- AUTOCOMPLETADO ---
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    
    const { data } = await supabase
        .from('base_cards')
        .select('event_type')
        .not('event_type', 'is', null);

    if (!data) return interaction.respond([]);

    const uniqueEvents = [...new Set(data.map(item => item.event_type))];
    const filtered = uniqueEvents.filter(choice => choice.toLowerCase().includes(focusedValue));

    await interaction.respond(
        filtered.slice(0, 25).map(choice => ({ name: capitalize(choice), value: choice }))
    );
  },

  async execute(interaction) {
    const hasPermission = interaction.member.roles.cache.some(role => ALLOWED_ROLES.includes(role.id));
    if (!hasPermission) {
      return interaction.reply({ content: '🚫 No tienes permisos para usar este comando.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Obtener datos
      const baseId = interaction.options.getString('id').toUpperCase().trim();
      const group = interaction.options.getString('grupo').trim();
      const idol = interaction.options.getString('artista').trim();
      const eventRaw = interaction.options.getString('evento').toLowerCase().trim();
      const image = interaction.options.getAttachment('imagen');
      
      const claimAuth = interaction.options.getBoolean('reclamar_autoria');
      const creatorName = claimAuth ? interaction.user.username : 'William System';
      const eventDisplay = capitalize(eventRaw);

      if (!image.contentType.startsWith('image/')) {
        return interaction.editReply('❌ El archivo debe ser una imagen.');
      }

      const { data: existingCard } = await supabase
        .from('base_cards')
        .select('card_code')
        .eq('card_code', baseId)
        .maybeSingle();

      if (existingCard) {
        return interaction.editReply(`⛔ El ID \`${baseId}\` ya existe.`);
      }

      // --- PREVIEW (Solo para ti) ---
      const previewEmbed = new EmbedBuilder()
        .setColor('#9b59b6')
        .setTitle(`🎉 Confirmar Evento: ${eventDisplay}`)
        .setDescription(`Se guardará como **${eventRaw}**.\n\n**Visual:**\n**${idol} — ${group}**\nEvento: ${eventDisplay}\nCode: ${baseId}`)
        .setImage(image.url)
        .setFooter({ text: `Créditos internos: ${creatorName}` });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_event').setLabel('Subir y Anunciar').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('cancel_event').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
      );

      const msg = await interaction.editReply({ embeds: [previewEmbed], components: [buttons] });
      const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

      collector.on('collect', async i => {
        if (i.customId === 'cancel_event') {
          await i.update({ content: '❌ Cancelado.', embeds: [], components: [] });
          return;
        }

        if (i.customId === 'confirm_event') {
          await i.update({ content: '⏳ Procesando...', components: [] });

          try {
            // A. Cloudinary
            const upload = await cloudinary.uploader.upload(image.url, { 
                folder: `photocards/${eventRaw}`, 
                public_id: baseId, 
                format: 'webp',
                overwrite: true 
            });

            // B. Supabase
            const { error } = await supabase.from('base_cards').insert({
                card_code: baseId,
                name: idol,
                group_name: group,
                image_url: upload.secure_url,
                rarity: 'rare',      
                rarity_level: 2,     
                is_active: true,
                era: eventDisplay,   
                event_type: eventRaw,
                creator: creatorName 
            });

            if (error) throw error;

            // C. ANUNCIO OFICIAL (Canal de Cards)
            const logEmbed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle('✨ New event photocards have been added!')
                .setDescription(
                    `**${idol} — ${group}**\n` +
                    `Evento: ${eventDisplay}\n` +
                    `${strawberryEmoji} ${strawberryEmoji} Code: ${baseId}`
                )
                .setImage(upload.secure_url)
                .setFooter({ text: 'added by: strawberrysweeties' });

            // Enviar al canal de anuncios
            try {
                const channel = await interaction.client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
                if (channel) await channel.send({ embeds: [logEmbed] });
            } catch (chanErr) {
                console.error("No se pudo enviar al canal de anuncios:", chanErr);
            }

            await interaction.editReply({ content: '✅ Carta subida y anunciada correctamente.', embeds: [] });

          } catch (err) {
            console.error(err);
            await interaction.editReply(`❌ Error al guardar: ${err.message}`);
          }
        }
      });

      collector.on('end', collected => {
         if (collected.size === 0) interaction.editReply({ content: '⏰ Tiempo agotado.', components: [] });
      });

    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Error inesperado.');
    }
  }
};
