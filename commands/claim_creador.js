const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ROLES PERMITIDOS (Managers/Admins)
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim_creador')
    .setDescription('ADMIN: Reclama la autoría de una carta o era completa.')
    // --- TODOS LOS CAMPOS SON OPCIONALES AHORA ---
    .addStringOption(option => 
      option.setName('code')
        .setDescription('El código base exacto (ej: TWICE.FANCY.NAYEON)')
        .setRequired(false)
    )
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
        .setDescription('Nombre del idol (Opcional si usas Grupo+Era)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // 1. VERIFICAR PERMISOS
    const memberRoles = interaction.member.roles.cache;
    const hasPermission = ALLOWED_ROLES.some(roleId => memberRoles.has(roleId));

    if (!hasPermission) {
      return interaction.reply({ 
        content: '🚫 **Acceso Denegado:** Solo los creadores/admins pueden usar esto.', 
        ephemeral: true 
      });
    }

    const code = interaction.options.getString('code');
    const group = interaction.options.getString('grupo');
    const era = interaction.options.getString('era');
    const artist = interaction.options.getString('artista');
    
    // El nombre que aparecerá en la carta
    const newCreatorName = interaction.user.username; 

    try {
      await interaction.deferReply();

      // Iniciamos la consulta de actualización en la tabla base_cards
      let query = supabase.from('base_cards').update({ creator: newCreatorName }).select();
      let filterDescription = "";

      // --- LÓGICA DE PRIORIDAD ---

      // CASO 1: Si hay CÓDIGO, tiene prioridad máxima.
      // Busca la carta base exacta (lo que ingresaste en /card_create)
      if (code) {
        query = query.eq('card_code', code.trim());
        filterDescription = `Código exacto: \`${code.trim()}\``;
      } 
      // CASO 2: Si no hay código, verificamos GRUPO y ERA (Deben estar ambos)
      else if (group && era) {
        // Usamos 'ilike' para que no importen las mayúsculas/minúsculas
        query = query.ilike('group_name', group.trim()).ilike('era', era.trim());
        filterDescription = `Grupo: ${group}, Era: ${era}`;

        // Sub-caso: Si también especificó un ARTISTA
        if (artist) {
            // Busca que el nombre CONTENGA lo que escribiste (ej: "Nayeon" encontrará "Nayeon - TWICE")
            query = query.ilike('name', `%${artist.trim()}%`);
            filterDescription += `, Artista: ${artist}`;
        } else {
            filterDescription += ` (Era Completa)`;
        }
      } 
      // CASO 3: Datos insuficientes
      else {
        return interaction.editReply('⚠️ **Faltan datos.**\nDebes proporcionar:\n1. Un `code` exacto.\nO BIEN\n2. `grupo` Y `era` juntos.');
      }

      // --- EJECUTAR ACTUALIZACIÓN ---
      const { data: updatedCards, error } = await query;

      if (error) throw error;

      if (!updatedCards || updatedCards.length === 0) {
        return interaction.editReply(`⚠️ No encontré ninguna carta que coincida con: ${filterDescription}`);
      }

      // --- RESPUESTA ---
      // Preparamos una lista de ejemplo (máximo 5 cartas para no saturar)
      const exampleList = updatedCards.slice(0, 5).map(c => `• ${c.name} (${c.card_code})`).join('\n');
      const remainingCount = updatedCards.length > 5 ? `\n...y ${updatedCards.length - 5} más.` : '';

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ Autoría Reclamada Exitosamente')
        .setDescription(`Se ha actualizado el creador en la base de datos.`)
        .addFields(
            { name: '👤 Nuevo Creador', value: `@${newCreatorName}`, inline: true },
            { name: '🔢 Cartas Actualizadas', value: `${updatedCards.length}`, inline: true },
            { name: '📋 Filtro Usado', value: filterDescription, inline: false },
            { name: 'Ejemplos actualizados', value: exampleList + remainingCount || 'Ninguno', inline: false }
        )
        .setFooter({ text: 'Esto se reflejará inmediatamente en el comando /photocard.' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en claim_creador:', error);
      await interaction.editReply('❌ Error interno al actualizar la base de datos.');
    }
  }
};
