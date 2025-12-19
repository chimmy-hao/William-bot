const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ROLES PERMITIDOS
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim_creador')
    .setDescription('ADMIN: Reclama la autoría usando autocompletado para evitar errores.')
    .addStringOption(option => 
      option.setName('code')
        .setDescription('Código Base (ej: WMO). Actualizará WMO1, WMO2, etc.')
        .setAutocomplete(true) // <--- Activa el autocompletado
    )
    .addStringOption(option => 
      option.setName('grupo')
        .setDescription('Nombre del grupo (Selecciona de la lista)')
        .setAutocomplete(true) // <--- Activa el autocompletado
    )
    .addStringOption(option => 
      option.setName('era')
        .setDescription('Nombre de la era (Selecciona de la lista)')
        .setAutocomplete(true) // <--- Activa el autocompletado
    )
    .addStringOption(option => 
      option.setName('artista')
        .setDescription('Nombre del idol (Opcional, filtra dentro de la Era)')
        .setAutocomplete(true) // <--- Activa el autocompletado
    ),

  // --- LÓGICA DE AUTOCOMPLETADO ---
  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const userInput = focusedOption.value;

    try {
      let query;
      let column;

      // Configuramos qué buscar según qué campo esté escribiendo el usuario
      if (focusedOption.name === 'grupo') column = 'group_name';
      if (focusedOption.name === 'era') column = 'era';
      if (focusedOption.name === 'artista') column = 'name'; // La columna name suele ser "Idol - Group"
      if (focusedOption.name === 'code') column = 'card_code';

      // Hacemos la consulta a Supabase (Limitado a 25 resultados por regla de Discord)
      // Usamos .ilike para buscar coincidencias parciales
      const { data, error } = await supabase
        .from('base_cards')
        .select(column)
        .ilike(column, `%${userInput}%`)
        .limit(50); // Traemos 50 para filtrar duplicados luego

      if (error || !data) return interaction.respond([]);

      // Limpiamos duplicados (Set) y preparamos para Discord
      // Para 'code', tratamos de mostrar códigos limpios
      const uniqueValues = [...new Set(data.map(item => item[column]))];
      
      // Discord solo acepta máximo 25 opciones
      const slicedOptions = uniqueValues.slice(0, 25);

      await interaction.respond(
        slicedOptions.map(choice => ({ name: choice, value: choice }))
      );

    } catch (err) {
      console.error('Error autocomplete:', err);
      // Si falla, respondemos vacío para que no se quede cargando infinito
      await interaction.respond([]); 
    }
  },

  // --- LÓGICA DE EJECUCIÓN ---
  async execute(interaction) {
    // 1. VERIFICAR PERMISOS
    const memberRoles = interaction.member.roles.cache;
    const hasPermission = ALLOWED_ROLES.some(roleId => memberRoles.has(roleId));

    if (!hasPermission) {
      return interaction.reply({ content: '🚫 Solo Admins/Managers.', ephemeral: true });
    }

    const code = interaction.options.getString('code');
    const group = interaction.options.getString('grupo');
    const era = interaction.options.getString('era');
    const artist = interaction.options.getString('artista');
    const newCreatorName = interaction.user.username; 

    try {
      await interaction.deferReply();

      let query = supabase.from('base_cards').update({ creator: newCreatorName }).select();
      let filterMsg = "";

      // PRIORIDAD 1: CÓDIGO BASE
      // Si pusiste "WMO", buscará "WMO%" para encontrar WMO1, WMO2, WMO3
      if (code) {
        // Quitamos números finales por si acaso el usuario eligió "WMO1" del autocomplete
        // pero quería toda la serie. Aunque lo más seguro es usar like.
        const cleanCode = code.trim(); 
        
        // Buscamos cualquier carta que EMPIECE con ese código
        query = query.ilike('card_code', `${cleanCode}%`);
        filterMsg = `Código base: ${cleanCode} (y variantes)`;
      } 
      // PRIORIDAD 2: GRUPO + ERA (Obligatorios ambos si no hay código)
      else if (group && era) {
        query = query.eq('group_name', group).eq('era', era);
        filterMsg = `Grupo: ${group} | Era: ${era}`;

        if (artist) {
            // Buscamos coincidencia parcial en el nombre ("Est Supha" encuentra "Est Supha - Collab")
            query = query.ilike('name', `%${artist}%`);
            filterMsg += ` | Artista: ${artist}`;
        } else {
            filterMsg += ` (Era Completa)`;
        }
      } 
      else {
        return interaction.editReply('⚠️ **Datos insuficientes.**\nUsa el autocompletado para elegir un `code` O (`grupo` + `era`).');
      }

      // EJECUTAR UPDATE
      const { data: updatedCards, error } = await query;

      if (error) throw error;

      if (!updatedCards || updatedCards.length === 0) {
        return interaction.editReply(`⚠️ **No se actualizó nada.**\nFiltro intentado: ${filterMsg}\n\nPosible causa: Los datos seleccionados no coinciden exactamente con la base de datos.`);
      }

      // RESPUESTA EXITOSA
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ Creador Asignado')
        .setDescription(`Has reclamado la autoría de **${updatedCards.length}** cartas.`)
        .addFields(
            { name: 'Creador', value: `@${newCreatorName}`, inline: true },
            { name: 'Filtro', value: filterMsg, inline: true },
            { name: 'Ejemplos', value: updatedCards.slice(0, 3).map(c => `• ${c.name} (${c.card_code})`).join('\n') || '...', inline: false }
        )
        .setFooter({ text: 'Verifica usando /photocard o /inventory' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error claim_creador:', error);
      await interaction.editReply('❌ Error de base de datos.');
    }
  }
};
