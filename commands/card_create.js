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

// Emoji personalizado
const strawberryEmoji = '<:strawberrity:1411384728119939182>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('card_create')
    .setDescription('Managers: add new photocards (3 variants)')
    .addStringOption(opt =>
      opt.setName('id').setDescription('Base ID (e.g. WMO)').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('group').setDescription('Group name').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('idol').setDescription('Idol name').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('era').setDescription('Album / Era').setRequired(true)
    )
    .addAttachmentOption(opt =>
      opt.setName('image1').setDescription('First image (rareza 1)').setRequired(true)
    )
    .addAttachmentOption(opt =>
      opt.setName('image2').setDescription('Second image (rareza 2)').setRequired(true)
    )
    .addAttachmentOption(opt =>
      opt.setName('image3').setDescription('Third image (rareza 3)').setRequired(true)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Roles permitidos
      const allowedRoles = ['1411356087977906317', '1411356161063518228'];
      const memberRoles = interaction.member.roles.cache;
      const hasRole = allowedRoles.some(roleId => memberRoles.has(roleId));
      if (!hasRole) return interaction.editReply('❌ No tienes permisos para usar este comando.');

      const baseId = interaction.options.getString('id').toUpperCase();
      const group = interaction.options.getString('group');
      const idol = interaction.options.getString('idol');
      const era = interaction.options.getString('era');
      const img1 = interaction.options.getAttachment('image1');
      const img2 = interaction.options.getAttachment('image2');
      const img3 = interaction.options.getAttachment('image3');

      // Verificar usuario en DB
      await supabase.from('users').upsert([
        { user_id: interaction.user.id, username: interaction.user.username }
      ], { onConflict: 'user_id' });

      // Subir imágenes a Cloudinary
      const uploadWebp = async (url, public_id) =>
        cloudinary.uploader.upload(url, { folder: 'photocards', public_id, format: 'webp', overwrite: true });

      const up1 = await uploadWebp(img1.url, `${baseId}1`);
      const up2 = await uploadWebp(img2.url, `${baseId}2`);
      const up3 = await uploadWebp(img3.url, `${baseId}3`);

      // Insertar cartas en DB (usar insert, no upsert)
      // SOLO el card_code base, sin secuencia
      const cards = [
        { card_code: `${baseId}1`, name: `${idol} — ${group}`, group_name: group, image_url: up1.secure_url, rarity: 'common', rarity_level: 1, era },
        { card_code: `${baseId}2`, name: `${idol} — ${group}`, group_name: group, image_url: up2.secure_url, rarity: 'rare', rarity_level: 2, era },
        { card_code: `${baseId}3`, name: `${idol} — ${group}`, group_name: group, image_url: up3.secure_url, rarity: 'legendary', rarity_level: 3, era }
      ];

      const { error } = await supabase.from('base_cards').insert(cards);
      if (error) throw new Error(error.message);

      // Crear anuncio con emojis según rareza y código base
      const embed = new EmbedBuilder()
        .setColor('#2c2d31')
        .setTitle('✨ New photocards have been added!')
        .setDescription(
          `**${idol} — ${group}**\nEra ${era}\n\n` +
          `${strawberryEmoji} | ${baseId}1\n` +
          `${strawberryEmoji}${strawberryEmoji} | ${baseId}2\n` +
          `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji} | ${baseId}3\n`
        )
        .setFooter({ text: `added by: ${interaction.user.username}` });

      // Enviar al canal de anuncios con try/catch
      try {
        const channel = await interaction.client.channels.fetch('1411784592192573601');
        if (!channel) throw new Error('Canal no encontrado o sin permisos');
        await channel.send({ embeds: [embed] });
      } catch (channelError) {
        console.error('Error enviando anuncio:', channelError.message);
      }

      await interaction.editReply('✅ Photocards added and announced!');
    } catch (err) {
      console.error('Error en card_create:', err);
      await interaction.editReply(`❌ An error occurred while adding the photocards: ${err.message}`);
    }
  },
};

