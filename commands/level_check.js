const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType 
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN ---
const strawberryEmoji = '<:strawberrity:1411384728119939182>'; 
const ITEMS_PER_PAGE = 10; 

// Helper para emojis de rareza
const getRarityEmoji = (level) => {
  if (level === 1) return strawberryEmoji;
  if (level === 2) return `${strawberryEmoji}${strawberryEmoji}`;
  if (level === 3) return `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`;
  return strawberryEmoji;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level_check') // 👈 Puedes cambiarlo a 'casting' o 'ready'
    .setDescription('📋 Ver cartas listas para subir de nivel (10+ copias)')
    .addStringOption(opt =>
      opt.setName('group')
        .setDescription('Filtrar por Grupo')
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('idol')
        .setDescription('Filtrar por Idol')
        .setAutocomplete(true)
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const focusName = focused.name;

    if (focusName === 'group') {
      const { data } = await supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
      // Filtramos duplicados y vacíos
      const unique = [...new Set(data.map(g => g.group_name))];
      const filtered = unique.filter(g => g.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }
    
    if (focusName === 'idol') {
      const { data } = await supabase.from('base_cards').select('name');
      // Limpiamos nombre (quitamos eras si están en el nombre)
      const unique = [...new Set(data.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = unique.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    const groupFilter = interaction.options.getString('group');
    const idolFilter = interaction.options.getString('idol');

    await interaction.deferReply();

    try {
      // 1. Consultar inventario
      let query = supabase
        .from('user_cards')
        .select(`
           rarity,
           base_cards!inner (name, group_name, era)
        `)
        .eq('user_id', userId);

      // Aplicar filtros de búsqueda si el usuario los usó
      if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);
      if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);

      const { data: cards, error } = await query;

      if (error) {
        console.error(error);
        return interaction.editReply('❌ Error al consultar la base de datos.');
      }

      if (!cards || cards.length === 0) {
        return interaction.editReply('📭 No tienes cartas que coincidan con esos filtros.');
      }

      // 2. Agrupar y Contar
      const inventory = {};

      cards.forEach(c => {
        const cleanName = c.base_cards.name.split(' — ')[0].trim();
        const group = c.base_cards.group_name || 'Soloist';
        const era = c.base_cards.era || 'Unknown';
        const rarity = c.rarity;

        // Clave única: Grupo + Idol + Era + Rareza
        const key = `${group}|${cleanName}|${era}|${rarity}`;
        
        if (!inventory[key]) {
            inventory[key] = {
                group,
                name: cleanName,
                era,
                rarity,
                count: 0
            };
        }
        inventory[key].count++;
      });

      // 3. Filtrar y Ordenar
      // SOLO mostramos las que tienen 10 o más (Listas para combinar)
      let readyList = Object.values(inventory).filter(item => item.count >= 10);

      if (readyList.length === 0) {
        return interaction.editReply('💤 Aún no tienes 10 copias de ninguna carta para combinar.');
      }

      // Ordenar: Grupo (A-Z) -> Idol (A-Z) -> Era (A-Z) -> Rareza (Asc)
      readyList.sort((a, b) => {
        return a.group.localeCompare(b.group) || 
               a.name.localeCompare(b.name) || 
               a.era.localeCompare(b.era) || 
               (a.rarity - b.rarity);
      });

      // 4. Paginación
      const totalPages = Math.ceil(readyList.length / ITEMS_PER_PAGE);
      let currentPage = 1;

      const generateEmbed = (page) => {
        const start = (page - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageItems = readyList.slice(start, end);

        const description = pageItems.map(item => {
          const emoji = getRarityEmoji(item.rarity);
          // Calculamos cuántos "Level Ups" puede hacer (ej: 23 cartas = 2 Level Ups)
          const possibleCombinations = Math.floor(item.count / 10);
          
          return `✅ **${item.group}** ${item.name} (${item.era}) ${emoji}\n└─ Tienes: **${item.count}** (Alcanza para **+${possibleCombinations}** niveles)`;
        }).join('\n\n');

        return new EmbedBuilder()
          .setColor('#2ecc71') // Verde "Ready"
          .setTitle('🚀 Cartas listas para Level Up')
          .setDescription(description)
          .setFooter({ text: `Página ${page} de ${totalPages} • Usa /level_up (o /debut) para combinarlas` });
      };

      const generateButtons = (page) => {
        const row = new ActionRowBuilder();
        row.addComponents(
          new ButtonBuilder().setCustomId('prev').setLabel('◀️').setStyle(ButtonStyle.Primary).setDisabled(page === 1),
          new ButtonBuilder().setCustomId('next').setLabel('▶️').setStyle(ButtonStyle.Primary).setDisabled(page === totalPages)
        );
        return row;
      };

      const msg = await interaction.editReply({
        embeds: [generateEmbed(currentPage)],
        components: totalPages > 1 ? [generateButtons(currentPage)] : []
      });

      if (totalPages <= 1) return;

      // 5. Collector de Botones
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000 
      });

      collector.on('collect', async i => {
        if (i.user.id !== userId) return i.reply({ content: '❌ Solo tú puedes cambiar la página.', ephemeral: true });

        if (i.customId === 'prev' && currentPage > 1) currentPage--;
        if (i.customId === 'next' && currentPage < totalPages) currentPage++;

        await i.update({
          embeds: [generateEmbed(currentPage)],
          components: [generateButtons(currentPage)]
        });
      });

      collector.on('end', () => {
        const disabledRow = generateButtons(currentPage);
        disabledRow.components.forEach(btn => btn.setDisabled(true));
        msg.edit({ components: [disabledRow] }).catch(() => {});
      });

    } catch (err) {
      console.error('Error en level_check:', err);
      await interaction.editReply('❌ Ocurrió un error inesperado.');
    }
  }
};
