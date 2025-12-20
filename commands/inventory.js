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

// Emoji de fresa
const strawberryEmoji = '<:strawberrity:1411384728119939182>';
// Emoji NFT
const nftEmoji = '<:nft:1441792691787792566>';

// Configuración de rareza
const rarityConfig = {
  1: { stars: `${strawberryEmoji}`, name: 'Rareza 1', color: '#95a5a6' },
  2: { stars: `${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 2', color: '#3498db' },
  3: { stars: `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 3', color: '#9b59b6' }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('📚 Muestra tu colección con filtros avanzados')
    .addUserOption(opt => 
      opt.setName('user') 
        .setDescription('¿El inventario de quién quieres ver?')
        .setRequired(false)
    )
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
      opt.setName('events')
        .setDescription('Filtrar por evento (Próximamente)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('¿Qué quieres ver?')
        .setRequired(false)
        .addChoices(
            { name: 'Photocards', value: 'cards' },
            { name: 'Items (Packs)', value: 'items' }
        )
    )
    .addStringOption(opt =>
        opt.setName('sort')
          .setDescription('Orden de visualización')
          .setRequired(false)
          .addChoices(
              { name: 'new (Más nuevas)', value: 'new' },
              { name: 'old (Más viejas)', value: 'old' },
              { name: 'number (Por código)', value: 'number' },
              { name: 'era (Por Era)', value: 'era' },
              { name: 'idol (Alfabético Idol)', value: 'idol' },
              { name: 'group (Alfabético Grupo)', value: 'group' }
          )
      ),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const focusName = focusedOption.name;
    const userValue = focusedOption.value.toLowerCase();

    const selectedGroup = interaction.options.getString('group');
    const selectedIdol = interaction.options.getString('idol');

    // AUTOCOMPLETADO DE GRUPOS
    if (focusName === 'group') {
      let query = supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
      if (selectedIdol) query = query.ilike('name', `%${selectedIdol}%`);
      const { data: groups } = await query;
      if (!groups) return interaction.respond([]);
      const uniqueGroups = [...new Set(groups.map(g => g.group_name))];
      const filtered = uniqueGroups.filter(g => g.toLowerCase().includes(userValue)).slice(0, 25);
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }

    // AUTOCOMPLETADO DE IDOLS
    if (focusName === 'idol') {
      let query = supabase.from('base_cards').select('name');
      if (selectedGroup) query = query.eq('group_name', selectedGroup);
      const { data: idols } = await query;
      if (!idols) return interaction.respond([]);
      const uniqueIdols = [...new Set(idols.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = uniqueIdols.filter(n => n.toLowerCase().includes(userValue)).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }

    // AUTOCOMPLETADO DE ERAS
    if (focusName === 'eras') {
        let query = supabase.from('base_cards').select('era').not('era', 'is', null);
        if (selectedGroup) query = query.eq('group_name', selectedGroup);
        if (selectedIdol) query = query.ilike('name', `%${selectedIdol}%`);
        const { data: eras } = await query;
        if (!eras) return interaction.respond([]);
        const uniqueEras = [...new Set(eras.map(e => e.era))];
        const filtered = uniqueEras.filter(e => e.toLowerCase().includes(userValue)).slice(0, 25);
        return interaction.respond(filtered.map(e => ({ name: e, value: e })));
    }
  },

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user; 
    const inventoryOwnerId = targetUser.id;
    const commandExecutorId = interaction.user.id; 

    const idolFilter = interaction.options.getString('idol');
    const groupFilter = interaction.options.getString('group');
    const rarityFilter = interaction.options.getInteger('rarity');
    const eraFilter = interaction.options.getString('eras');
    const typeFilter = interaction.options.getString('type') || 'cards';
    const sortFilter = interaction.options.getString('sort') || 'new'; 

    try {
      await interaction.deferReply();

      // --- MODO ITEMS (PACKS) ---
      if (typeFilter === 'items') {
        const { data: packs, error: packsError } = await supabase
            .from('user_packs')
            .select('quantity, packs(name, emoji)')
            .eq('user_id', inventoryOwnerId)
            .gt('quantity', 0);

        if (packsError || !packs || packs.length === 0) {
            const msg = targetUser.id === commandExecutorId 
                ? '🎁 No tienes packs en tu inventario.'
                : `🎁 ${targetUser.username} no tiene packs.`;
            return interaction.editReply(msg);
        }

        const list = packs.map(p => `${p.packs.emoji} ${p.packs.name} x${p.quantity}`).join('\n');
        const embed = new EmbedBuilder()
            .setColor('#f1c40f')
            .setTitle(`🎁 Packs de ${targetUser.username}`)
            .setDescription(list)
            .setTimestamp();
        
        return interaction.editReply({ embeds: [embed] });
      }

      // --- MODO CARTAS ---
      
      // 1. Cargar Cartas + HOLDERS (MODIFICADO)
      let query = supabase
        .from('user_cards')
        .select(`
          id, rarity, unique_card_id,
          base_cards!inner (name, group_name, rarity, rarity_level, era, card_code),
          holders!equipped_holder_id (emoji)
        `)
        .eq('user_id', inventoryOwnerId);

      if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);
      if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);
      if (eraFilter) query = query.ilike('base_cards.era', `%${eraFilter}%`);
      if (rarityFilter) query = query.eq('rarity', rarityFilter);

      switch (sortFilter) {
        case 'old': query = query.order('id', { ascending: true }); break;
        case 'number': query = query.order('unique_card_id', { ascending: true }); break;
        case 'idol': query = query.order('name', { foreignTable: 'base_cards', ascending: true }); break;
        case 'group': query = query.order('group_name', { foreignTable: 'base_cards', ascending: true }); break;
        case 'era': query = query.order('era', { foreignTable: 'base_cards', ascending: true }); break;
        default: query = query.order('id', { ascending: false }); break;
      }

      const { data: cards, error } = await query;
      if (error) throw error;
      if (!cards || cards.length === 0) return interaction.editReply(`😢 No se encontraron photocards.`);

      // 2. Cargar Lista NFT del usuario (para el icono)
      const { data: nftList } = await supabase.from('user_nfts').select('*').eq('user_id', inventoryOwnerId);
      
      // Crear Sets para búsqueda rápida
      const nftGroups = new Set(nftList?.filter(n => n.target_type === 'group').map(n => n.target_name.toLowerCase()) || []);
      const nftIdols = new Set(nftList?.filter(n => n.target_type === 'idol').map(n => n.target_name.toLowerCase()) || []);

      // Paginación
      let page = 0;
      const pageSize = 10;

      const generateEmbed = (page) => {
        const start = page * pageSize;
        const end = start + pageSize;
        const shown = cards.slice(start, end);

        return new EmbedBuilder()
          .setColor('#2ecc71')
          .setTitle(`📚 Inventario de ${targetUser.username}`)
          .setDescription(
            shown.map(c => {
                const rarity = rarityConfig[c.rarity] || rarityConfig[1];
                const rawName = c.base_cards.name || 'Unknown';
                const cleanName = rawName.split(' — ')[0].trim();
                const group = c.base_cards.group_name || 'sin grupo';
                const era = c.base_cards.era || 'desconocida';
                const code = c.unique_card_id || c.base_cards.card_code;
                
                // VERIFICACIÓN NFT
                const isNft = nftGroups.has(group.toLowerCase()) || nftIdols.has(cleanName.toLowerCase());
                const nftStatus = isNft ? ` ${nftEmoji}` : '';

                // (MODIFICADO) EMOJI DEL HOLDER
                const holderEmoji = c.holders ? ` ${c.holders.emoji}` : '';

                return `${rarity.stars} ${cleanName}${holderEmoji} — ${group} (${era})${nftStatus}\n\`${code}\``;
              }).join('\n\n')
          )
          .setFooter({ text: `Página ${page + 1}/${Math.ceil(cards.length / pageSize)} • Total: ${cards.length} cartas` })
          .setTimestamp();
      };

      const generateRow = (currPage) => {
        const totalPages = Math.ceil(cards.length / pageSize);
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('prev').setLabel('⬅️').setStyle(ButtonStyle.Primary).setDisabled(currPage === 0),
          new ButtonBuilder().setCustomId('next').setLabel('➡️').setStyle(ButtonStyle.Primary).setDisabled(currPage >= totalPages - 1),
          new ButtonBuilder().setCustomId('show_ids').setLabel('🔍 IDs').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('show_items').setLabel('🎁 Items').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('cancel').setLabel('❌ Cerrar').setStyle(ButtonStyle.Danger)
        );
      };

      const message = await interaction.editReply({ 
        embeds: [generateEmbed(page)], 
        components: [generateRow(page)] 
      });

      // Collector
      const collector = message.createMessageComponentCollector({
        time: 120000, // 2 minutos
        filter: i => i.user.id === commandExecutorId 
      });

      collector.on('collect', async i => {
        try {
            if (i.customId === 'cancel') {
                collector.stop('closed_by_user');
                await interaction.deleteReply().catch(() => {}); 
                return;
            }

            if (i.customId === 'prev') page--;
            if (i.customId === 'next') page++;

            if (i.customId === 'prev' || i.customId === 'next') {
                await i.update({ 
                    embeds: [generateEmbed(page)], 
                    components: [generateRow(page)] 
                });
            }

            if (i.customId === 'show_ids') {
                const start = page * pageSize;
                const end = start + pageSize;
                const currentIds = cards.slice(start, end).map(c => c.unique_card_id || c.base_cards.card_code).join(' ');
                await i.reply({ content: currentIds || 'No IDs', ephemeral: true });
            }

            if (i.customId === 'show_items') {
                const { data: p } = await supabase.from('user_packs').select('quantity, packs(name, emoji)').eq('user_id', inventoryOwnerId).gt('quantity', 0);
                const l = p?.map(x => `${x.packs.emoji} ${x.packs.name} x${x.quantity}`).join('\n') || 'Sin packs';
                await i.reply({ embeds: [new EmbedBuilder().setColor('#f1c40f').setDescription(l)], ephemeral: true });
            }

        } catch (error) {
            console.error("Error en botón:", error);
            if (!i.replied && !i.deferred) {
                await i.reply({ content: '❌ Error al procesar la acción.', ephemeral: true }).catch(() => {});
            }
        }
      });

      collector.on('end', async (_, reason) => {
        if (reason !== 'closed_by_user') {
            try {
                const disabledRow = generateRow(page);
                disabledRow.components.forEach(btn => btn.setDisabled(true));
                await message.edit({ components: [disabledRow] });
            } catch (e) {}
        }
      });

    } catch (err) {
      console.error('Error fatal en inventory:', err);
      try { await interaction.editReply('❌ Ocurrió un error al mostrar el inventario.'); } catch (e) {}
    }
  }
};
