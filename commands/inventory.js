cconst { 
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
    .setDescription('📚 Muestra tu colección de photocards')
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
      // Traemos nombres y los limpiamos también en el buscador para que se vea bonito
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
    const userId = interaction.user.id;
    const idolFilter = interaction.options.getString('idol');
    const groupFilter = interaction.options.getString('group');

    try {
      await interaction.deferReply();

      // Construir consulta
      let query = supabase
        .from('user_cards')
        .select(`
          id,
          rarity,
          unique_card_id,
          base_cards (
            name,
            group_name,
            rarity,
            rarity_level,
            era,
            card_code
          )
        `)
        .eq('user_id', userId);

      // Filtros de búsqueda
      if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);
      if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);

      const { data: cards, error } = await query;

      if (error) {
        console.error('Error buscando inventario:', error);
        throw new Error('Error al obtener tu colección');
      }

      if (!cards || cards.length === 0) {
        return interaction.editReply(
          `😢 No tienes photocards${idolFilter || groupFilter ? ' con esos filtros' : ''}.`
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
          .setTitle(`📚 Inventario de ${interaction.user.username}`)
          .setDescription(
            shown
              .map(c => {
                const rarity = rarityConfig[c.rarity] || rarityConfig[1];
                
                // === CORRECCIÓN VISUAL: LIMPIEZA DE NOMBRE ===
                // "Idol — Grupo" se convierte solo en "Idol" para no repetir el grupo después
                const rawName = c.base_cards.name || 'Desconocido';
                const cleanName = rawName.split(' — ')[0].trim();
                
                const group = c.base_cards.group_name || 'sin grupo';
                const era = c.base_cards.era || 'desconocida';
                const code = c.unique_card_id || c.base_cards.card_code;

                // Formato final: 🍓 Idol — Grupo (Era)
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

      const collector = message.createMessageComponentCollector({
        time: 120000, // 2 minutos
        filter: i => i.user.id === userId
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

          // === CORRECCIÓN IDs: TEXTO PLANO SEPARADO POR ESPACIOS ===
          const idString = shown
            .map(c => c.unique_card_id || c.base_cards.card_code || c.id)
            .join(' '); // Separados solo por espacio

          await i.reply({
            content: idString || 'No hay IDs disponibles.',
            ephemeral: true
          });

        } else if (i.customId === 'show_items') {
          const { data: packs, error: packsError } = await supabase
            .from('user_packs')
            .select('quantity, packs(name, emoji)')
            .eq('user_id', userId)
            .gt('quantity', 0);

          if (packsError || !packs || packs.length === 0) {
            return i.reply({ content: '🎁 No tienes packs en tu inventario.', ephemeral: true });
          }

          const list = packs.map(p => `${p.packs.emoji} ${p.packs.name} x${p.quantity}`).join('\n');

          await i.reply({
            embeds: [
              new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle(`🎁 Packs de ${interaction.user.username}`)
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
      await interaction.editReply('❌ Ocurrió un error al mostrar tu colección.');
    }
  }
};