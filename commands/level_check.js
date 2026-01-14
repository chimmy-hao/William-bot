const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType,
  AttachmentBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// Conexión Supabase (La toma del entorno directamente para evitar errores de paso)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN ---
const strawberryEmoji = '<:strawberrity:1411384728119939182>'; 
const ITEMS_PER_PAGE = 5; // Menos items por página para que se vea mejor en móvil
const BOT_ID = process.env.CLIENT_ID; 

// Helper para emojis
const getRarityEmoji = (level) => {
  if (level === 1) return strawberryEmoji;
  if (level === 2) return `${strawberryEmoji}${strawberryEmoji}`;
  if (level === 3) return `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`;
  return strawberryEmoji;
};

// Helper ID
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level_check') // Nombre del comando
    .setDescription('🍓 Revisa qué cartas tienes listas para subir de nivel (10+)')
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

  // --- AUTOCOMPLETADO BLINDADO ---
  async autocomplete(interaction) {
    try {
        const focused = interaction.options.getFocused(true);
        const focusName = focused.name;
        const searchTerm = focused.value.toLowerCase();

        if (focusName === 'group') {
            const { data } = await supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
            if (!data) return interaction.respond([]);
            
            // Filtramos duplicados
            const unique = [...new Set(data.map(g => g.group_name))];
            const filtered = unique.filter(g => g.toLowerCase().includes(searchTerm)).slice(0, 25);
            
            await interaction.respond(filtered.map(g => ({ name: g, value: g })));
        }
        
        else if (focusName === 'idol') {
            const { data } = await supabase.from('base_cards').select('name');
            if (!data) return interaction.respond([]);

            // Limpiamos nombre
            const unique = [...new Set(data.map(i => i.name.split(' — ')[0].trim()))];
            const filtered = unique.filter(n => n.toLowerCase().includes(searchTerm)).slice(0, 25);
            
            await interaction.respond(filtered.map(n => ({ name: n, value: n })));
        }
    } catch (error) {
        // 🛡️ ESCUDO: Si falla, no hacemos nada. Esto evita el crash del index.js
        console.error("Error silencioso en autocomplete:", error.message);
        try { await interaction.respond([]); } catch (e) {}
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

      // Filtros
      if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);
      if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);

      const { data: cards, error } = await query;

      if (error) {
        console.error(error);
        return interaction.editReply('❌ Error al leer la base de datos.');
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

        const key = `${group}|${cleanName}|${era}|${rarity}`;
        
        if (!inventory[key]) {
            inventory[key] = { group, name: cleanName, era, rarity, count: 0 };
        }
        inventory[key].count++;
      });

      // 3. Filtrar: SOLO las que tienen 10 o más
      let readyList = Object.values(inventory).filter(item => item.count >= 10);

      // Ordenar: Grupo -> Idol -> Era -> Rareza
      readyList.sort((a, b) => {
        return a.group.localeCompare(b.group) || 
               a.name.localeCompare(b.name) || 
               a.era.localeCompare(b.era) || 
               (a.rarity - b.rarity);
      });

      if (readyList.length === 0) {
        // Mensaje amigable si tiene cartas pero ninguna llega a 10 copias
        return interaction.editReply({ 
            content: `🗃️ Tienes cartas de **${groupFilter || idolFilter || 'tu inventario'}**, pero ninguna acumula las **10 copias** necesarias para subir de nivel todavía.` 
        });
      }

      // 4. Paginación
      const totalPages = Math.ceil(readyList.length / ITEMS_PER_PAGE);
      let currentPage = 1;

      const generateEmbed = (page) => {
        const start = (page - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageItems = readyList.slice(start, end);

        const description = pageItems.map(item => {
          const emoji = getRarityEmoji(item.rarity);
          // Calculamos cuántos levels ups puede hacer
          const upgrades = Math.floor(item.count / 10);
          
          return `✅ **${item.group}**\n└ ${item.name} (${item.era}) ${emoji} • Tienes: **${item.count}** (Alcanza para **${upgrades}** mejoras)`;
        }).join('\n\n');

        return new EmbedBuilder()
          .setColor('#ff9f43') 
          .setTitle(`🚀 Cartas listas para Level Up (${readyList.length})`)
          .setDescription(description)
          .setFooter({ text: `Página ${page} de ${totalPages} • Usa /level_up para mejorar` });
      };

      const generateButtons = (page) => {
        const row = new ActionRowBuilder();
        row.addComponents(
          new ButtonBuilder().setCustomId('prev').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
          new ButtonBuilder().setCustomId('next').setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages)
        );
        return row;
      };

      const msg = await interaction.editReply({
        embeds: [generateEmbed(currentPage)],
        components: totalPages > 1 ? [generateButtons(currentPage)] : []
      });

      if (totalPages <= 1) return;

      // Collector
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
      // Aquí el .reply sí funciona porque estamos dentro del comando, no del autocomplete
      if (!interaction.replied) await interaction.editReply('❌ Ocurrió un error inesperado.');
    }
  }
};
