const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN ---
const nftEmoji = '<:nft:1441792691787792566>'; 

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nft')
    .setDescription('Gestiona tu lista de cartas No Intercambiables (Not For Trade)')
    
    // SUBCOMANDO: ADD
    .addSubcommand(sub => 
      sub.setName('add')
        .setDescription('Marca cartas como No Intercambiables')
        .addStringOption(opt => opt.setName('group').setDescription('Marca todas las cartas de un grupo').setAutocomplete(true))
        .addStringOption(opt => opt.setName('idol').setDescription('Marca todas las cartas de un idol').setAutocomplete(true))
    )
    
    // SUBCOMANDO: REMOVE
    .addSubcommand(sub => 
      sub.setName('remove')
        .setDescription('Quita la marca de No Intercambiable')
        .addStringOption(opt => opt.setName('group').setDescription('Desmarca un grupo').setAutocomplete(true))
        .addStringOption(opt => opt.setName('idol').setDescription('Desmarca un idol').setAutocomplete(true))
    )

    // SUBCOMANDO: VIEW
    .addSubcommand(sub => 
      sub.setName('view')
        .setDescription('Mira tu lista de cartas NFT')
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    
    if (focused.name === 'group') {
      const { data: groups } = await supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
      const unique = [...new Set(groups.map(g => g.group_name))];
      const filtered = unique.filter(g => g.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }
    
    if (focused.name === 'idol') {
      const { data: idols } = await supabase.from('base_cards').select('name');
      const unique = [...new Set(idols.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = unique.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    try {
      await interaction.deferReply();

      // === LÓGICA PARA ADD Y REMOVE ===
      if (subcommand === 'add' || subcommand === 'remove') {
        const group = interaction.options.getString('group');
        const idol = interaction.options.getString('idol');
        const newValue = (subcommand === 'add'); // true = marcar, false = desmarcar

        if (!group && !idol) {
          return interaction.editReply('⚠️ Debes seleccionar un **Grupo** o un **Idol**.');
        }

        // 1. Buscar cartas coincidentes
        let query = supabase
          .from('user_cards')
          .select(`id, base_cards!inner(name, group_name)`)
          .eq('user_id', userId);

        if (group) query = query.ilike('base_cards.group_name', `%${group}%`);
        if (idol) query = query.ilike('base_cards.name', `%${idol}%`);

        const { data: cardsToUpdate, error: findError } = await query;

        if (findError) throw findError;
        if (!cardsToUpdate || cardsToUpdate.length === 0) {
          return interaction.editReply('❌ No tienes cartas que coincidan con esos filtros.');
        }

        // 2. Actualizar
        const ids = cardsToUpdate.map(c => c.id);
        const { error: updateError } = await supabase
          .from('user_cards')
          .update({ is_nft: newValue })
          .in('id', ids);

        if (updateError) throw updateError;

        const actionText = newValue ? `marcadas como NFT ${nftEmoji}` : 'desmarcadas (ahora son tradeables)';
        return interaction.editReply(`✅ Se han actualizado **${ids.length}** cartas: Han sido ${actionText}.`);
      }

      // === LÓGICA PARA VIEW ===
      if (subcommand === 'view') {
        const { data: nftCards, error } = await supabase
          .from('user_cards')
          .select(`
            unique_card_id,
            base_cards (name, group_name)
          `)
          .eq('user_id', userId)
          .eq('is_nft', true)
          .order('id', { ascending: true });

        if (error) throw error;
        if (!nftCards || nftCards.length === 0) {
          return interaction.editReply('📭 Tu lista de NFT está vacía.');
        }

        // Agrupar
        const grouped = {};
        nftCards.forEach(card => {
          const gName = card.base_cards.group_name || 'Solista';
          if (!grouped[gName]) grouped[gName] = [];
          grouped[gName].push(card.base_cards.name.split(' — ')[0].trim());
        });

        const listItems = Object.entries(grouped).map(([group, idols]) => {
          const uniqueIdols = [...new Set(idols)];
          return `**${group}**\n${uniqueIdols.join('\n')}`;
        });

        // Paginación
        let page = 0;
        const itemsPerPage = 4; 
        const totalPages = Math.ceil(listItems.length / itemsPerPage);

        const generateEmbed = (currPage) => {
          const start = currPage * itemsPerPage;
          const currentItems = listItems.slice(start, start + itemsPerPage);
          
          return new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(`🔒 Lista NFT (Página ${currPage + 1}/${totalPages})`)
            .setDescription(currentItems.join('\n\n'))
            .setFooter({ text: `Total cartas protegidas: ${nftCards.length}` });
        };

        const generateButtons = (currPage) => {
          const row = new ActionRowBuilder();
          row.addComponents(
            new ButtonBuilder().setCustomId('prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(currPage === 0),
            new ButtonBuilder().setCustomId('next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(currPage === totalPages - 1)
          );
          return row;
        };

        const message = await interaction.editReply({
          embeds: [generateEmbed(page)],
          components: totalPages > 1 ? [generateButtons(page)] : []
        });

        if (totalPages > 1) {
          const collector = message.createMessageComponentCollector({ time: 60000 });
          collector.on('collect', async i => {
            if (i.user.id !== userId) return i.reply({ content: 'No es tu lista.', ephemeral: true });
            
            if (i.customId === 'prev') page--;
            if (i.customId === 'next') page++;
            
            await i.update({
              embeds: [generateEmbed(page)],
              components: [generateButtons(page)]
            });
          });
        }
      }

    } catch (err) {
      console.error(err);
      await interaction.editReply('❌ Ocurrió un error al procesar el comando NFT.');
    }
  }
};
