const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// CONFIGURACIÓN
const nftEmoji = '<:nft:1456378008826019973>'; 

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nft')
    .setDescription('Gestiona tu lista de prioridades/bloqueados (NFT)')
    
    // SUBCOMANDO: ADD
    .addSubcommand(sub => 
      sub.setName('add')
        .setDescription('Agrega un Grupo o Idols a tu lista NFT')
        .addStringOption(opt => opt.setName('group').setDescription('Selecciona un grupo').setAutocomplete(true))
        .addStringOption(opt => 
            opt.setName('members')
               .setDescription('¿Quieres agregar a todos los miembros del grupo?')
               .addChoices(
                   { name: 'Sí, agregar todo el grupo', value: 'yes' },
                   { name: 'No, solo especificaré idols individuales', value: 'no' }
               )
        )
        // Aclaramos en la descripción que acepta comas
        .addStringOption(opt => opt.setName('idol').setDescription('Idol(s) específico(s) separados por coma').setAutocomplete(true))
    )
    
    // SUBCOMANDO: REMOVE
    .addSubcommand(sub => 
      sub.setName('remove')
        .setDescription('Elimina un Grupo o Idol de tu lista NFT')
        .addStringOption(opt => opt.setName('group').setDescription('Eliminar grupo de la lista').setAutocomplete(true))
        .addStringOption(opt => opt.setName('idol').setDescription('Eliminar idol de la lista').setAutocomplete(true))
    )

    // SUBCOMANDO: VIEW
    .addSubcommand(sub => 
      sub.setName('view')
        .setDescription('Mira tu lista de artistas NFT')
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    
    if (focused.name === 'group') {
      const { data } = await supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
      const unique = [...new Set(data.map(g => g.group_name))];
      const filtered = unique.filter(g => g.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }
    
    if (focused.name === 'idol') {
      const { data } = await supabase.from('base_cards').select('name');
      const unique = [...new Set(data.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = unique.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    try {
      await interaction.deferReply();

      // === ADD ===
      if (subcommand === 'add') {
        const group = interaction.options.getString('group');
        const idolInput = interaction.options.getString('idol'); // Puede contener comas
        const membersOption = interaction.options.getString('members');

        if (!group && !idolInput) return interaction.editReply('⚠️ Selecciona un **Grupo** o escribe **Idols**.');

        const inserts = [];

        // 1. Lógica para Grupo
        if (group) {
            if (membersOption === 'no') {
                if (!idolInput) return interaction.editReply('⚠️ Elegiste "No agregar todo el grupo", por favor especifica los idols.');
            } else {
                // Agregamos el GRUPO COMPLETO
                inserts.push({ user_id: userId, target_type: 'group', target_name: group });
            }
        }

        // 2. Lógica para Idols (Múltiples separados por coma)
        if (idolInput) {
            // Separamos por coma, limpiamos espacios y filtramos vacíos
            const idolsArray = idolInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
            
            for (const idolName of idolsArray) {
                // Opcional: Podríamos validar si el idol existe en DB, pero asumimos que el usuario sabe escribirlo o usó el autocomplete para el primero
                inserts.push({ user_id: userId, target_type: 'idol', target_name: idolName });
            }
        }

        if (inserts.length === 0) return interaction.editReply('⚠️ No se realizó ninguna acción.');

        const { error } = await supabase.from('user_nfts').upsert(inserts, { onConflict: 'user_id, target_type, target_name' });
        
        if (error) throw error;

        // Mensaje de éxito formateado
        const namesAdded = inserts.map(i => i.target_name).join(', ');
        return interaction.editReply(`✅ Lista actualizada. Agregado: **${namesAdded}** ${nftEmoji}.`);
      }

      // === REMOVE ===
      if (subcommand === 'remove') {
        const group = interaction.options.getString('group');
        const idol = interaction.options.getString('idol');

        if (!group && !idol) return interaction.editReply('⚠️ Selecciona qué quitar.');

        let query = supabase.from('user_nfts').delete().eq('user_id', userId);
        
        const conditions = [];
        if (group) conditions.push(`target_name.eq.${group}`);
        if (idol) conditions.push(`target_name.eq.${idol}`);
        
        query = query.or(conditions.join(','));

        const { error } = await query;
        if (error) throw error;

        return interaction.editReply(`✅ Se han eliminado de tu lista NFT.`);
      }

      // === VIEW (LOGICA DE AGRUPACIÓN) ===
      if (subcommand === 'view') {
        const { data: nfts } = await supabase.from('user_nfts').select('*').eq('user_id', userId);

        if (!nfts || nfts.length === 0) return interaction.editReply('📭 Tu lista NFT está vacía.');

        // Separar grupos e idols
        const fullGroups = nfts.filter(n => n.target_type === 'group').map(n => n.target_name);
        const individualIdols = nfts.filter(n => n.target_type === 'idol').map(n => n.target_name);

        let idolDisplay = "Ninguno";

        // Si hay idols individuales, buscamos sus grupos para mostrarlos bonitos
        if (individualIdols.length > 0) {
            // Consultamos la tabla base_cards para saber el grupo de cada idol
            // Buscamos cualquier carta que coincida con el nombre del idol
            const { data: cardsInfo } = await supabase
                .from('base_cards')
                .select('name, group_name')
                .in('name', individualIdols.map(name => {
                    // El truco es que en base_cards el nombre es "Idol — Group", necesitamos buscar coincidencia parcial o ajustar la búsqueda.
                    // Para simplificar y ser eficientes, asumimos que el nombre guardado en NFT es el nombre limpio.
                    // Haremos una búsqueda aproximada o traeremos todo y filtraremos en JS.
                    return name; 
                }));
            
            // Nota: Como 'name' en base_cards suele ser "Idol — Group", la búsqueda exacta .in() podría fallar si guardaste solo "Idol".
            // Vamos a intentar obtener los grupos haciendo una búsqueda más amplia o usando lo que ya tenemos.
            // MEJOR ESTRATEGIA: Traemos todos los grupos posibles para esos idols.
            
            const { data: allIds } = await supabase
                .from('base_cards')
                .select('name, group_name');
            
            // Mapeamos: { "Felix": "Stray Kids", "Momo": "TWICE" }
            const idolGroupMap = {};
            if (allIds) {
                allIds.forEach(c => {
                    const cleanName = c.name.split(' — ')[0].trim();
                    if (individualIdols.includes(cleanName)) {
                        idolGroupMap[cleanName] = c.group_name || "Sin Grupo";
                    }
                });
            }

            // Agrupamos visualmente: { "Stray Kids": ["Felix", "Hyunjin"], "TWICE": ["Momo"] }
            const groupedDisplay = {};
            individualIdols.forEach(idol => {
                const grp = idolGroupMap[idol] || "Otros";
                if (!groupedDisplay[grp]) groupedDisplay[grp] = [];
                groupedDisplay[grp].push(idol);
            });

            // Construimos el texto
            const lines = [];
            for (const [grp, ids] of Object.entries(groupedDisplay)) {
                if (grp === "Otros") {
                    lines.push(`**Varios:** ${ids.join(', ')}`);
                } else {
                    lines.push(`**${grp}:** ${ids.join(', ')}`);
                }
            }
            idolDisplay = lines.join('\n');
        }

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(`🔒 Lista NFT de ${interaction.user.username}`)
            .setDescription(`Tus cartas protegidas con ${nftEmoji}.`)
            .addFields(
                { name: '🏢 Grupos Completos', value: fullGroups.length ? fullGroups.join('\n') : 'Ninguno', inline: false },
                { name: '👤 Idols Individuales', value: idolDisplay, inline: false }
            );

        return interaction.editReply({ embeds: [embed] });
      }

    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Error al procesar NFT.');
    }
  }
};
