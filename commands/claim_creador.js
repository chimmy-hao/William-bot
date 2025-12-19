const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ROLES PERMITIDOS
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim_creador')
    .setDescription('ADMIN: Reclama la autoría usando autocompletado.')
    .addStringOption(option => 
      option.setName('code')
        .setDescription('Código Base (ej: WMO).')
        .setAutocomplete(true)
    )
    .addStringOption(option => 
      option.setName('grupo')
        .setDescription('Nombre del grupo')
        .setAutocomplete(true)
    )
    .addStringOption(option => 
      option.setName('era')
        .setDescription('Nombre de la era')
        .setAutocomplete(true)
    )
    .addStringOption(option => 
      option.setName('artista')
        .setDescription('Nombre del idol (Busca coincidencia parcial)')
        .setAutocomplete(true)
    ),

  // --- LÓGICA DE AUTOCOMPLETADO ---
  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const userInput = focusedOption.value;

    try {
      let column;
      // Mapeamos la opción al nombre real de la columna en Supabase
      if (focusedOption.name === 'grupo') column = 'group_name';
      else if (focusedOption.name === 'era') column = 'era';
      else if (focusedOption.name === 'artista') column = 'name';
      else if (focusedOption.name === 'code') column = 'card_code';
      else return interaction.respond([]);

      // Buscamos coincidencias
      const { data } = await supabase
        .from('base_cards')
        .select(column)
        .ilike(column, `%${userInput}%`) // ilike = insensible a mayúsculas/minúsculas
        .limit(25); 

      if (!data) return interaction.respond([]);

      // Filtramos duplicados y limpiamos resultados vacíos
      const uniqueValues = [...new Set(data.map(item => item[column]).filter(val => val))];
      
      // Discord solo acepta 25 opciones máximo
      await interaction.respond(
        uniqueValues.slice(0, 25).map(choice => ({ name: choice, value: choice }))
      );

    } catch (err) {
      // Silencioso en logs para no spamear
      await interaction.respond([]); 
    }
  },

  // --- LÓGICA DE EJECUCIÓN ---
  async execute(interaction) {
    const memberRoles = interaction.member.roles.cache;
    const hasPermission = ALLOWED_ROLES.some(roleId => memberRoles.has(roleId));

    if (!hasPermission) return interaction.reply({ content: '🚫 Solo Admins.', ephemeral: true });

    const code = interaction.options.getString('code');
    const group = interaction.options.getString('grupo');
    const era = interaction.options.getString('era');
    const artist = interaction.options.getString('artista');
    const newCreatorName = interaction.user.username; 

    try {
      await interaction.deferReply();

      // Preparamos la actualización
      let query = supabase.from('base_cards').update({ creator: newCreatorName }).select();
      let filterMsg = "";

      // CASO 1: POR CÓDIGO (Prioridad)
      if (code) {
        const cleanCode = code.trim();
        query = query.ilike('card_code', `${cleanCode}%`); // % busca WMO1, WMO2...
        filterMsg = `Código: ${cleanCode}`;
      } 
      // CASO 2: GRUPO + ERA
      else if (group && era) {
        // Usamos ilike para evitar errores de mayúsculas
        query = query.ilike('group_name', group.trim()).ilike('era', era.trim());
        filterMsg = `Grupo: ${group} | Era: ${era}`;

        // CASO 2.1: CON ARTISTA ESPECÍFICO
        if (artist) {
            // AQUÍ ESTÁ EL ARREGLO IMPORTANTE:
            // Usamos %artista% para encontrar "Est Supha" dentro de "Est Supha — Collab"
            const cleanArtist = artist.trim();
            query = query.ilike('name', `%${cleanArtist}%`);
            filterMsg += ` | Artista: ${cleanArtist}`;
        } else {
            filterMsg += ` (Era Completa)`;
        }
      } 
      else {
        return interaction.editReply('⚠️ Faltan datos: Usa `code` O (`grupo` + `era`).');
      }

      // Ejecutar
      const { data: updatedCards, error } = await query;

      if (error) throw error;

      if (!updatedCards || updatedCards.length === 0) {
        return interaction.editReply(`⚠️ **No se actualizó nada.**\nFiltro usado: ${filterMsg}\nVerifica que el nombre del grupo/era esté bien escrito.`);
      }

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ Creador Asignado')
        .setDescription(`Has reclamado la autoría de **${updatedCards.length}** cartas.`)
        .addFields(
            { name: 'Creador', value: `@${newCreatorName}`, inline: true },
            { name: 'Filtro', value: filterMsg, inline: true },
            { name: 'Cartas', value: updatedCards.slice(0, 5).map(c => `• ${c.name}`).join('\n') || 'Varias...', inline: false }
        )
        .setFooter({ text: 'Cambios aplicados inmediatamente.' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error claim_creador:', error);
      await interaction.editReply('❌ Error al conectar con la base de datos.');
    }
  }
};
