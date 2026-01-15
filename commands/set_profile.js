const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set_profile')
    .setDescription('🖼️ Personaliza tu perfil del bot')
    .addAttachmentOption(option => 
        option.setName('image')
            .setDescription('Sube la imagen que quieres usar en tu perfil')
            .setRequired(true)
    ),

  async execute(interaction) {
    const image = interaction.options.getAttachment('image');
    
    // Validamos que sea una imagen
    if (!image.contentType.startsWith('image/')) {
        return interaction.reply({ content: '❌ Por favor sube un archivo de imagen válido (JPG, PNG, GIF).', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        // Guardamos la URL de la imagen en Supabase
        const { error } = await supabase
            .from('users')
            .update({ profile_image: image.url })
            .eq('user_id', interaction.user.id);

        if (error) throw error;

        const embed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('✅ Perfil Actualizado')
            .setDescription('Tu imagen de perfil personalizada ha sido guardada.')
            .setThumbnail(image.url);

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error(error);
        await interaction.editReply('❌ Hubo un error al guardar tu imagen.');
    }
  }
};
