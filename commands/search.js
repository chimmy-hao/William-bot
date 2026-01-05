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
const nftEmoji = '<:nft:1456378008826019973>';

// Configuración de rareza
const rarityConfig = {
  1: { stars: `${strawberryEmoji}`, name: 'Rareza 1', color: '#95a5a6' },
  2: { stars: `${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 2', color: '#3498db' },
  3: { stars: `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 3', color: '#9b59b6' }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('🔍 Búsqueda global de cartas en todos los inventarios')
    .addStringOption(opt =>
      opt.setName('group')
        .setDescription('Filtrar por grupo')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('idol')
        .setDescription('Filtrar por idol')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addIntegerOption(opt =>
      opt.setName('rarity')
        .setDescription('Filtrar por rareza')
        .setMinValue(1)
        .setMaxValue(3)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('eras')
        .setDescription('Filtrar por Era')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
        opt.setName('sort')
          .setDescription('Orden de visualización')
          .setRequired(false)
          .addChoices(
              { name: 'new (Más nuevas)', value: 'new' },
              { name: 'old (Más viejas)', value: 'old' },
              { name: 'number (Por código)', value: 'number' },
              { name: 'idol (Alfabético Idol)', value: 'idol' }
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
      const uniqueGroups = [...new Set(groups.map(g => g.group_name))];
      return interaction.respond(uniqueGroups.filter(g => g.toLowerCase().includes(userValue)).slice(0, 25).map(g => ({ name: g, value: g })));
    }

    if (focusName === 'idol') {
      let query = supabase.from('base_cards').select('name');
      if (selectedGroup) query = query.eq('group_name', selectedGroup);
      const { data: idols } = await query;
      if (!idols) return interaction.respond([]);
      const uniqueIdols = [...new Set(idols.map(i => i.name.split(' — ')[0].trim()))];
      return interaction.respond(uniqueIdols.filter(n => n.toLowerCase().includes(userValue)).slice(0, 25).map(n => ({ name: n, value: n })));
    }

    if (focusName === 'eras') {
        let query = supabase.from('base_cards').select('era').not('era', 'is', null);
        if (selectedGroup) query = query.eq('group_name', selectedGroup);
        if (selectedIdol) query = query.ilike('name', `%${selectedIdol}%`);
        const { data: eras } = await query;
        if (!eras) return interaction.respond([]);
        const uniqueEras = [...new Set(eras.map(e => e.era))];
        return interaction.respond(uniqueEras.filter(e => e.toLowerCase().includes(userValue)).slice(0, 25).map(e => ({ name: e, value: e })));
    }
  },

  async execute(interaction) {
    const idolFilter = interaction.options.getString('idol');
    const groupFilter = interaction.options.getString('group');
    const rarityFilter = interaction.options.getInteger('rarity');
    const eraFilter = interaction.options.getString('eras');
    const sortFilter = interaction.options.getString('sort') || 'new'; 

    if (!idolFilter && !groupFilter && !rarityFilter && !eraFilter) {
        return interaction.reply({ content: '⚠️ Por favor, usa al menos un filtro (Grupo, Idol, Rareza o Era) para buscar.', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // 1. CONSULTA DE CARTAS
      let query = supabase
        .from('user_cards')
        .select(`
          id,
          user_id, 
          rarity,
          unique_card_id,
          base_cards!inner (
            name,
            group_name,
            rarity,
            rarity_level,
            era,
            card_code
          )
        `);

      if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);
      if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);
      if (eraFilter) query = query.ilike('base_cards.era', `%${eraFilter}%`);
      if (rarityFilter) query = query.eq('rarity', rarityFilter);

      switch (sortFilter) {
        case 'old': query = query.order('id', { ascending: true }); break;
        case 'number': query = query.order('unique_card_id', { ascending: true }); break;
        case 'idol': query = query.order('name', { foreignTable: 'base_cards', ascending: true }); break;
        default: query = query.order('id', { ascending: false }); break;
      }

      query = query.limit(500);

      const { data: cards, error } = await query;

      if (error) {
        console.error('Error searching:', error);
        return interaction.editReply('❌ Error al realizar la búsqueda.');
      }

      if (!cards || cards.length === 0) {
        return interaction.editReply(`😢 No se encontraron cartas con esos filtros.`);
      }

      // 2. LÓGICA DE NFT (FIX)
      // Obtenemos los IDs de los usuarios encontrados en la búsqueda
      const userIds = [...new Set(cards.map(c => c.user_id))];

      // Consultamos las preferencias NFT de ESOS usuarios
      const { data: nfts } = await supabase
        .from('user_nfts')
        .select('user_id, target_type, target_name')
        .in('user_id', userIds);

      // Creamos un mapa rápido para verificar NFT:  nftMap[userId] = { groups: Set, idols: Set }
      const nftMap = {};
      if (nfts) {
        nfts.forEach(n => {
            if (!nftMap[n.user_id]) nftMap[n.user_id] = { groups: new Set(), idols: new Set() };
            if (n.target_type === 'group') nftMap[n.user_id].groups.add(n.target_name.toLowerCase());
            if (n.target_type === 'idol') nftMap[n.user_id].idols.add(n.target_name.toLowerCase());
        });
      }

      // Paginación
      let page = 0;
      const pageSize = 9;

      const generateEmbed = (page) => {
        const start = page * pageSize;
        const end = start + pageSize;
        const shown = cards.slice(start, end);

        const embed = new EmbedBuilder()
          .setColor('#e91e63')
          .setTitle(`🔍 Búsqueda Global (${cards.length} resultados)`)
          .setFooter({ text: `Página ${page + 1}/${Math.ceil(cards.length / pageSize)}` })
          .setTimestamp();

        shown.forEach(c => {
            const rarity = rarityConfig[c.rarity] || rarityConfig[1];
            const cleanName = c.base_cards.name.split(' — ')[0].trim();
            const group = c.base_cards.group_name || 'sin grupo';
            const era = c.base_cards.era || '??';
            
            // VERIFICACIÓN NFT (ESPECÍFICA PARA EL DUEÑO DE LA CARTA)
            let isNft = false;
            if (nftMap[c.user_id]) {
                const userPrefs = nftMap[c.user_id];
                if (userPrefs.groups.has(group.toLowerCase())) isNft = true;
                if (userPrefs.idols.has(cleanName.toLowerCase())) isNft = true;
            }
            const nftStatus = isNft ? ` ${nftEmoji}` : '';
            
            embed.addFields({
                name: `${rarity.stars} ${cleanName}`,
                value: `${group} (${era})${nftStatus}\n\`${c.unique_card_id}\`\n👤 <@${c.user_id}>`,
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
        filter: i => i.user.id === interaction.user.id 
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
      console.error('Error en search:', err);
      try { await interaction.editReply('❌ Ocurrió un error.'); } catch (e) {}
    }
  }
};
