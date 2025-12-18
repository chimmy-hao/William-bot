const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ROLES PERMITIDOS (Mismos que reset_cooldown)
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim_creador')
    .setDescription('ADMIN: Reclama la autoría de una carta o era completa.')
    // Opción A: Por Código
    .addStringOption(option => 
      option.setName('code')
        .setDescription('El código único de la carta (ej: AESPA.DRAMA.KARINA)')
        .setRequired(false)
    )
    // Opción B: Por Detalles (Grupo + Era + [Artista])
    .addStringOption(option => 
      option.setName('grupo')
        .setDescription('Nombre del grupo (ej: Twice)')
        .setRequired(false)
    )
    .addStringOption(option => 
      option.setName('era')
        .setDescription('Nombre de la era (ej: Fancy)')
        .setRequired(false)
    )
    .addStringOption(option => 
      option.setName('artista')
        .setDescription('Nombre del idol (Déjalo vacío para reclamar TODA la era)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // 1. VERIFICAR PERMISOS
    const memberRoles = interaction.member.roles.cache;
    const hasPermission = ALLOWED_ROLES.some(roleId => memberRoles.has(roleId));

    if (!hasPermission) {
      return interaction.reply({ 
        content: '🚫 **Acceso Denegado:** Solo los administradores pueden gestionar creadores.', 
        ephemeral: true 
      });
    }

    const code = interaction.options.getString('code');
    const group = interaction.options.getString('grupo');
    const era = interaction.options.getString('era');
    const artist = interaction.options.getString('artista');
    
    // El nombre que aparecerá en la carta (Usuario de Discord)
    // Usamos 'username' porque tu photocard.js añade el '@' automáticamente.
    const newCreatorName = interaction.user.username; 

    try {
      await interaction.deferReply();
      let query = supabase.from('base_cards').update({ creator: newCreatorName }).select();

      // --- LÓGICA DE FILTRADO ---
      
      // CASO 1: Por Código (Prioridad Máxima)
      if (code) {
        query = query.eq('card_code', code);
      } 
      // CASO 2: Por Grupo y Era
      else if (group && era) {
        // Usamos ilike para que no importen las mayúsculas/minúsculas
        query = query.ilike('group_name', group).ilike('era', era);
        
        // Si especificó artista, filtramos solo ese. Si no, ¡actualiza todos!
        if (artist) {
            // Nota: Asumimos que la columna 'name' en DB tiene el formato "Artista - Grupo" o similar.
            // Usamos ilike con % para buscar que el nombre CONTENGA lo que escribiste.
            query = query.ilike('name', `%${artist}%`);
        }
      } 
      else {
        return interaction.editReply('❌ **Faltan datos.** Debes proporcionar el `code` O (`grupo` + `era`).');
      }

      // EJECUTAR ACTUALIZACIÓN
      const { data: updatedCards, error } = await query;

      if (error) throw error;

      if (!updatedCards || updatedCards.length === 0) {
        return interaction.editReply('⚠️ No encontré ninguna carta que coincida con esos datos.');
      }

      // --- RESPUESTA ---
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ Autoría Reclamada')
        .setDescription(`Has sido registrado como el creador de **${updatedCards.length}** carta(s).`)
        .addFields(
            { name: 'Creador', value: `@${newCreatorName}`, inline: true },
            { name: 'Cartas actualizadas', value: updatedCards.map(c => `• ${c.name}`).slice(0, 10).join('\n') + (updatedCards.length > 10 ? '\n...y más.' : ''), inline: false }
        )
        .setFooter({ text: 'Aparecerá en el comando /photocard inmediatamente.' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en claim_creador:', error);
      await interaction.editReply('❌ Error al actualizar la base de datos.');
    }
  }
};
