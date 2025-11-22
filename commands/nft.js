const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// CONFIGURACIÓN
const nftEmoji = '<:nft:1441792691787792566>'; 

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nft')
    .setDescription('Gestiona tu lista de prioridades/bloqueados (NFT)')
    
    // SUBCOMANDO: ADD
    .addSubcommand(sub => 
      sub.setName('add')
        .setDescription('Agrega un Grupo o Idol a tu lista NFT')
        .addStringOption(opt => opt.setName('group').setDescription('Selecciona un grupo').setAutocomplete(true))
        .addStringOption(opt => 
            opt.setName('members')
               .setDescription('¿Quieres agregar a todos los miembros del grupo?')
               .addChoices(
                   { name: 'Sí, agregar todo el grupo', value: 'yes' },
                   { name: 'No, solo especificaré idols individuales', value: 'no' }
               )
        )
        .addStringOption(opt => opt.setName('idol').setDescription('Selecciona un idol específico').setAutocomplete(true))
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
        const idol = interaction.options.getString('idol');
        const membersOption = interaction.options.getString('members');

        if (!group && !idol) return interaction.editReply('⚠️ Selecciona un **Grupo** o un **Idol**.');

        const inserts = [];

        // Lógica para Grupo
        if (group) {
            if (membersOption === 'no') {
                // Si elige grupo pero dice "No, solo idols", le avisamos (salvo que haya puesto tambien un idol)
                if (!idol) return interaction.editReply('⚠️ Elegiste "No agregar todo el grupo", por favor selecciona un **Idol** específico en el campo correspondiente.');
            } else {
                // Si es 'yes' o no puso nada, agregamos el GRUPO
                inserts.push({ user_id: userId, target_type: 'group', target_name: group });
            }
        }

        // Lógica para Idol
        if (idol) {
            inserts.push({ user_id: userId, target_type: 'idol', target_name: idol });
        }

        if (inserts.length === 0) return interaction.editReply('⚠️ No se realizó ninguna acción.');

        const { error } = await supabase.from('user_nfts').upsert(inserts, { onConflict: 'user_id, target_type, target_name' });
        
        if (error) throw error;
        return interaction.editReply(`✅ Lista actualizada. Ahora tus cartas de **${inserts.map(i => i.target_name).join(' y ')}** aparecerán con ${nftEmoji}.`);
      }

      // === REMOVE ===
      if (subcommand === 'remove') {
        const group = interaction.options.getString('group');
        const idol = interaction.options.getString('idol');

        if (!group && !idol) return interaction.editReply('⚠️ Selecciona qué quitar.');

        let query = supabase.from('user_nfts').delete().eq('user_id', userId);
        
        // Construir filtro OR (borrar grupo O borrar idol)
        const conditions = [];
        if (group) conditions.push(`target_name.eq.${group}`);
        if (idol) conditions.push(`target_name.eq.${idol}`);
        
        query = query.or(conditions.join(','));

        const { error } = await query;
        if (error) throw error;

        return interaction.editReply(`✅ Se han eliminado de tu lista NFT.`);
      }

      // === VIEW ===
      if (subcommand === 'view') {
        const { data: nfts } = await supabase.from('user_nfts').select('*').eq('user_id', userId);

        if (!nfts || nfts.length === 0) return interaction.editReply('📭 Tu lista NFT está vacía.');

        const groups = nfts.filter(n => n.target_type === 'group').map(n => n.target_name);
        const idols = nfts.filter(n => n.target_type === 'idol').map(n => n.target_name);

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(`🔒 Lista NFT de ${interaction.user.username}`)
            .setDescription('Cualquier carta futura de estos artistas tendrá el ícono NFT automáticamente.')
            .addFields(
                { name: 'Grupos Completos', value: groups.length ? groups.join('\n') : 'Ninguno', inline: true },
                { name: 'Idols Individuales', value: idols.length ? idols.join('\n') : 'Ninguno', inline: true }
            );

        return interaction.editReply({ embeds: [embed] });
      }

    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Error al procesar NFT.');
    }
  }
};
