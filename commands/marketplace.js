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

// Emojis
const strawberryEmoji = '<:strawberrity:1411384728119939182>';
const moneyEmoji = '<:berrycoin:1411737957081288724>';

// Configuración de rareza
const rarityConfig = {
  1: { stars: `${strawberryEmoji}`, name: 'Rareza 1', color: '#95a5a6' },
  2: { stars: `${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 2', color: '#3498db' },
  3: { stars: `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 3', color: '#9b59b6' }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('marketplace')
    .setDescription('🏪 Explora las cartas en venta de otros jugadores')
    .addStringOption(opt => opt.setName('group').setDescription('Filtrar por grupo').setAutocomplete(true))
    .addStringOption(opt => opt.setName('idol').setDescription('Filtrar por idol').setAutocomplete(true))
    .addIntegerOption(opt => opt.setName('rarity').setDescription('Filtrar por rareza').setMinValue(1).setMaxValue(3))
    .addStringOption(opt => opt.setName('eras').setDescription('Filtrar por Era').setAutocomplete(true))
    .addUserOption(opt => opt.setName('seller').setDescription('Filtrar por vendedor específico'))
    .addStringOption(opt =>
        opt.setName('sort')
          .setDescription('Orden de visualización (Default: Menor Precio)')
          .addChoices(
              { name: 'Precio: Menor a Mayor', value: 'price_asc' }, 
              { name: 'Precio: Mayor a Menor', value: 'price_desc' },
              { name: 'Más recientes', value: 'new' },
              { name: 'Más antiguas', value: 'old' },
              { name: 'Idol (Alfabético)', value: 'idol' },
              { name: 'Grupo (Alfabético)', value: 'group' },
              { name: 'Era', value: 'era' }
          )
      ),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const focusName = focusedOption.name;
    const userValue = focusedOption.value.toLowerCase();
    const selectedGroup = interaction.options.getString('group');
    const selectedIdol = interaction.options.getString('idol');

    if (focusName === 'group') {
      let query = supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
      if (selectedIdol) query = query.ilike('name', `%${selectedIdol}%`);
      const { data: groups } = await query;
      if (!groups) return interaction.respond([]);
      const unique = [...new Set(groups.map(g => g.group_name))];
      return interaction.respond(unique.filter(g => g.toLowerCase().includes(userValue)).slice(0, 25).map(g => ({ name: g, value: g })));
    }

    if (focusName === 'idol') {
      let query = supabase.from('base_cards').select('name');
      if (selectedGroup) query = query.eq('group_name', selectedGroup);
      const { data: idols } = await query;
      if (!idols) return interaction.respond([]);
      const unique = [...new Set(idols.map(i => i.name.split(' — ')[0].trim()))];
      return interaction.respond(unique.filter(n => n.toLowerCase().includes(userValue)).slice(0, 25).map(n => ({ name: n, value: n })));
    }

    if (focusName === 'eras') {
        let query = supabase.from('base_cards').select('era').not('era', 'is', null);
        if (selectedGroup) query = query.eq('group_name', selectedGroup);
        if (selectedIdol) query = query.ilike('name', `%${selectedIdol}%`);
        const { data: eras } = await query;
        if (!eras) return interaction.respond([]);
        const unique = [...new Set(eras.map(e => e.era))];
        return interaction.respond(unique.filter(e => e.toLowerCase().includes(userValue)).slice(0, 25).map(e => ({ name: e, value: e })));
    }
  },

  async execute(interaction) {
    const commandExecutorId = interaction.user.id; 

    const idolFilter = interaction.options.getString('idol');
    const groupFilter = interaction.options.getString('group');
    const rarityFilter = interaction.options.getInteger('rarity');
    const eraFilter = interaction.options.getString('eras');
    const sellerFilter = interaction.options.getUser('seller');
    const sortFilter = interaction.options.getString('sort') || 'price_asc'; 

    try {
      await interaction.deferReply();

      let query = supabase
        .from('user_cards')
        .select(`
          id, user_id, rarity, unique_card_id, market_price,
          base_cards!inner (name, group_name, rarity, rarity_level, era)
        `)
        .not('market_price', 'is', null);

      if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);
      if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);
      if (eraFilter) query = query.ilike('base_cards.era', `%${eraFilter}%`);
      if (rarityFilter) query = query.eq('rarity', rarityFilter);
      if (sellerFilter) query = query.eq('user_id', sellerFilter.id);

      switch (sortFilter) {
        case 'price_asc': query = query.order('market_price', { ascending: true }); break;
        case 'price_desc': query = query.order('market_price', { ascending: false }); break;
        case 'old': query = query.order('id', { ascending: true }); break;
        case 'new': query = query.order('id', { ascending: false }); break;
        case 'idol': query = query.order('name', { foreignTable: 'base_cards', ascending: true }); break;
        case 'group': query = query.order('group_name', { foreignTable: 'base_cards', ascending: true }); break;
        case 'era': query = query.order('era', { foreignTable: 'base_cards', ascending: true }); break;
        default: query = query.order('market_price', { ascending: true }); break;
      }

      const { data: cards, error } = await query;

      if (error) {
        console.error('Error marketplace:', error);
        throw new Error('Error al cargar el mercado');
      }

      if (!cards || cards.length === 0) {
        return interaction.editReply(`🏪 El mercado está vacío (o no hay resultados para esos filtros).`);
      }

      let page = 0;
      const pageSize = 9;

      const generateEmbed = (page) => {
        const start = page * pageSize;
        const end = start + pageSize;
        const shown = cards.slice(start, end);

        const embed = new EmbedBuilder()
          .setColor('#e91e63')
          .setTitle(`🏪 Marketplace (${cards.length} en venta)`)
          .setFooter({ text: `Página ${page + 1}/${Math.ceil(cards.length / pageSize)}` })
          .setTimestamp();

        shown.forEach(c => {
            const rarity = rarityConfig[c.rarity] || rarityConfig[1];
            const cleanName = c.base_cards.name.split(' — ')[0].trim();
            const group = c.base_cards.group_name || 'Solista';
            
            const seller = `<@${c.user_id}>`;
            const priceTag = `**${c.market_price}** ${moneyEmoji}`;

            embed.addFields({
                name: `${cleanName} ${rarity.stars}`,
                // DIAMANTE ELIMINADO AQUÍ
                value: `📂 ${group}\n${priceTag}\n\`${c.unique_card_id}\`\n👤 ${seller}`,
                inline: true 
            });
        });

        return embed;
      };

      const generateRow = (currPage) => {
        const totalPages = Math.ceil(cards.length / pageSize);
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('prev').setLabel('⬅️').setStyle(ButtonStyle.Primary).setDisabled(currPage === 0),
          new ButtonBuilder().setCustomId('next').setLabel('➡️').setStyle(ButtonStyle.Primary).setDisabled(currPage >= totalPages - 1),
          new ButtonBuilder().setCustomId('cancel').setLabel('❌ Cerrar').setStyle(ButtonStyle.Danger)
        );
      };

      const message = await interaction.editReply({ 
        embeds: [generateEmbed(page)], 
        components: [generateRow(page)] 
      });

      const collector = message.createMessageComponentCollector({
        time: 120000, 
        filter: i => i.user.id === commandExecutorId 
      });

      collector.on('collect', async i => {
        if (i.customId === 'cancel') {
            collector.stop('closed');
            await interaction.deleteReply().catch(() => {});
            return;
        }
        
        if (i.customId === 'prev') page--;
        if (i.customId === 'next') page++;

        await i.update({ 
            embeds: [generateEmbed(page)], 
            components: [generateRow(page)] 
        });
      });

      collector.on('end', async (_, reason) => {
        if (reason !== 'closed') {
            try {
                const disabledRow = generateRow(page);
                disabledRow.components.forEach(btn => btn.setDisabled(true));
                await message.edit({ components: [disabledRow] });
            } catch (e) {}
        }
      });

    } catch (err) {
      console.error('Error fatal en marketplace:', err);
      try { await interaction.editReply('❌ Ocurrió un error al abrir el mercado.'); } catch (e) {}
    }
  }
};
