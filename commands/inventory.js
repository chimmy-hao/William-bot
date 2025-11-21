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

// Configuración de rareza
const rarityConfig = {
  1: { stars: `${strawberryEmoji}`, name: 'Rareza 1', color: '#95a5a6' },
  2: { stars: `${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 2', color: '#3498db' },
  3: { stars: `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 3', color: '#9b59b6' }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('📚 Muestra tu colección o la de otro usuario')
    // 1. OPCIÓN DE USUARIO (Igual que en profile_view)
    .addUserOption(opt => 
      opt.setName('user')
        .setDescription('¿El inventario de quién quieres ver?')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('idol')
        .setDescription('Filtrar por idol')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('group')
        .setDescription('Filtrar por grupo')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'idol') {
      const { data: idols } = await supabase.from('base_cards').select('name');
      const uniqueIdols = [...new Set(idols.map(i => i.name.split(' — ')[0].trim()))];
      
      const filtered = uniqueIdols
        .filter(n => n.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);
        
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }

    if (focused.name === 'group') {
      const { data: groups } = await supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
      const uniqueGroups = [...new Set(groups.map(g => g.group_name))];
      
      const filtered = uniqueGroups
        .filter(g => g.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);
        
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }
  },

  async execute(interaction) {
    // 2. DEFINIR QUIÉN ES EL DUEÑO Y QUIÉN EJECUTA
    const targetUser = interaction.options.getUser('user') || interaction.user; // De quién son las cartas
    const inventoryOwnerId = targetUser.id;
    const commandExecutorId = interaction.user.id; // Quién toca los botones

    const idolFilter = interaction.options.getString('idol');
    const groupFilter = interaction.options.getString('group');

    try {
      await interaction.deferReply();

      // 3. SOLUCIÓN DEL ERROR DE FILTRO (!inner)
      // Usamos base_cards!inner(...) para que Supabase permita filtrar por columnas de esa tabla unida
      let query = supabase
        .from('user_cards')
        .select(`
          id,
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
        `)
        .eq('user_id', inventoryOwnerId);

      // Filtros de búsqueda
      if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);
      if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);

      // Ordenar para que salgan las nuevas primero (opcional, pero recomendado)
      query = query.order('id', { ascending: false });

      const { data: cards, error } = await query;

      if (error) {
        console.error('Error buscando inventario:', error);
        throw new Error('Error al obtener la colección'); // Esto activará el catch
      }

      if (!cards || cards.length === 0) {
        const filterMsg = idolFilter || groupFilter ? ' con esos filtros' : '';
        const userMsg = targetUser.id === commandExecutorId ? 'tienes' : 'tiene';
        return interaction.editReply(
          `😢 No ${userMsg} photocards${filterMsg}.`
        );
      }

      // Configuración de paginación
      let page = 0;
      const pageSize = 10;

      const generateEmbed = (page) => {
        const start = page * pageSize;
        const end = start + pageSize;
        const shown = cards.slice(start, end);

        return new EmbedBuilder()
          .setColor('#2ecc71')
          .setTitle(`📚 Inventario de ${targetUser.username}`) // Muestra el nombre del dueño
          .setDescription(
            shown
              .map(c => {
                const rarity = rarityConfig[c.rarity] || rarityConfig[1];
                
                // Limpieza visual del nombre
                const rawName = c.base_cards.name || 'Desconocido';
                const cleanName = rawName.split(' — ')[0].trim();
                
                const group = c.base_cards.group_name || 'sin grupo';
                const era = c.base_cards.era || 'desconocida';
                const code = c.unique_card_id || c.base_cards.card_code;

                return `${rarity.stars} ${cleanName} — ${group} (${era})\n\`${code}\``;
              })
              .join('\n\n')
          )
          .setFooter({ text: `Página ${page + 1}/${Math.ceil(cards.length / pageSize)} • Total: ${cards.length} cartas` })
          .setTimestamp();
      };

      const generateRow = (disabled = false) => new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('prev')
          .setLabel('⬅️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled || page === 0),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('➡️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled || page >= Math.ceil(cards.length / pageSize) - 1),
        new ButtonBuilder()
          .setCustomId('show_ids')
          .setLabel('🔍 IDs')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('show_items')
          .setLabel('🎁 Items')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId('cancel')
          .setLabel('❌ Cerrar')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled)
      );

      const message = await interaction.editReply({ 
        embeds: [generateEmbed(page)], 
        components: [generateRow()] 
      });

      // El colector permite que SOLO TÚ (el que escribió el comando) toque los botones,
      // incluso si estás viendo el inventario de otro.
      const collector = message.createMessageComponentCollector({
        time: 120000, // 2 minutos
        filter: i => i.user.id === commandExecutorId 
      });

      collector.on('collect', async i => {
        if (i.customId === 'prev') {
          page--;
          await i.update({ embeds: [generateEmbed(page)], components: [generateRow()] });
        } else if (i.customId === 'next') {
          page++;
          await i.update({ embeds: [generateEmbed(page)], components: [generateRow()] });
        } else if (i.customId === 'show_ids') {
          const start = page * pageSize;
          const end = start + pageSize;
          const shown = cards.slice(start, end);

          const idString = shown
            .map(c => c.unique_card_id || c.base_cards.card_code || c.id)
            .join(' ');

          await i.reply({
            content: idString || 'No hay IDs disponibles.',
            ephemeral: true
          });

        } else if (i.customId === 'show_items') {
          // Ver items del DUEÑO del inventario (inventoryOwnerId)
          const { data: packs, error: packsError } = await supabase
            .from('user_packs')
            .select('quantity, packs(name, emoji)')
            .eq('user_id', inventoryOwnerId)
            .gt('quantity', 0);

          if (packsError || !packs || packs.length === 0) {
            const msg = targetUser.id === commandExecutorId 
              ? '🎁 No tienes packs en tu inventario.'
              : `🎁 ${targetUser.username} no tiene packs.`;
            return i.reply({ content: msg, ephemeral: true });
          }

          const list = packs.map(p => `${p.packs.emoji} ${p.packs.name} x${p.quantity}`).join('\n');

          await i.reply({
            embeds: [
              new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle(`🎁 Packs de ${targetUser.username}`)
                .setDescription(list)
                .setTimestamp()
            ],
            ephemeral: true
          });
        } else if (i.customId === 'cancel') {
          collector.stop('cancelled');
          await i.deleteReply().catch(() => {});
        }
      });

      collector.on('end', async (_, reason) => {
        if (reason !== 'cancelled') {
          await message.edit({ components: [generateRow(true)] }).catch(() => {});
        }
      });

    } catch (err) {
      console.error('Error en /inventory:', err);
      // Si falló, intentamos editar el mensaje para mostrar el error
      try {
        await interaction.editReply('❌ Ocurrió un error al mostrar la colección. (Verifica si el idol/grupo está bien escrito)');
      } catch (e) {}
    }
  }
};
