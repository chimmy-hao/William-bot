const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
    .setDescription('Managers: añade cartas nuevas.')
    .addStringOption(opt => opt.setName('id').setDescription('Base ID (e.g. WMO)').setRequired(true))
    .addStringOption(opt => opt.setName('group').setDescription('Group name').setRequired(true))
    .addStringOption(opt => opt.setName('idol').setDescription('Idol name').setRequired(true))
    .addStringOption(opt => opt.setName('era').setDescription('Album / Era').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image1').setDescription('Common Image').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image2').setDescription('Rare Image').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image3').setDescription('Legendary Image').setRequired(true))
    // OPCIÓN: Interruptor para el Pool
    .addBooleanOption(opt => 
      opt.setName('en_espera')
      .setDescription('True = Guardar en Pool (Oculta). False/Vacío = Publicar YA.')
      .setRequired(true)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Verificar Roles
      const allowedRoles = ['1411356161063518228'];
      if (!allowedRoles.some(r => interaction.member.roles.cache.has(r))) {
        return interaction.editReply('❌ No tienes permisos.');
      }

      const baseId = interaction.options.getString('id').toUpperCase();
      const group = interaction.options.getString('group');
      const idol = interaction.options.getString('idol');
      const era = interaction.options.getString('era');
      
      const sendToPool = interaction.options.getBoolean('en_espera') || false;
      const isActive = !sendToPool; 

      // Verificar usuario
      await supabase.from('users').upsert([{ user_id: interaction.user.id }], { onConflict: 'user_id' });

      // Cloudinary
      const uploadWebp = async (url, pid) => cloudinary.uploader.upload(url, { folder: 'photocards', public_id: pid, format: 'webp', overwrite: true });
      const up1 = await uploadWebp(interaction.options.getAttachment('image1').url, `${baseId}1`);
      const up2 = await uploadWebp(interaction.options.getAttachment('image2').url, `${baseId}2`);
      const up3 = await uploadWebp(interaction.options.getAttachment('image3').url, `${baseId}3`);

      // Insertar en DB
      const cards = [
        { card_code: `${baseId}1`, name: idol, group_name: group, image_url: up1.secure_url, rarity: 'common', rarity_level: 1, era, is_active: isActive },
        { card_code: `${baseId}2`, name: idol, group_name: group, image_url: up2.secure_url, rarity: 'rare', rarity_level: 2, era, is_active: isActive },
        { card_code: `${baseId}3`, name: idol, group_name: group, image_url: up3.secure_url, rarity: 'legendary', rarity_level: 3, era, is_active: isActive }
      ];

      const { error } = await supabase.from('base_cards').insert(cards);
      if (error) throw new Error(error.message);

      // --- CONTADOR STAFF (Create) ---
      // 1. Buscamos acumulado
      const { data: userData } = await supabase.from('users').select('pending_creates').eq('user_id', interaction.user.id).single();
      const currentCreates = userData?.pending_creates || 0;

      // 2. Sumamos 3 (porque son 3 cartas: Common, Rare, Leg)
      await supabase.from('users').update({ 
          pending_creates: currentCreates + 3 
      }).eq('user_id', interaction.user.id);
      // -------------------------------

      // --- ANUNCIO PÚBLICO ---
      const embed = new EmbedBuilder()
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
        if (channel) await channel.send({ embeds: [embed] });
      } catch (e) { console.error('Error enviando anuncio:', e); }

      // --- RESPUESTA FINAL ---
      if (sendToPool) {
        await interaction.editReply(`🔒 **Anunciada y Guardada en Pool.**\nTrabajo registrado (+3 creates).`);
      } else {
        await interaction.editReply('✅ **Publicada y Anunciada.**\nTrabajo registrado (+3 creates).');
      }

    } catch (err) {
      console.error(err);
      await interaction.editReply(`❌ Error: ${err.message}`);
    }
  },
};
