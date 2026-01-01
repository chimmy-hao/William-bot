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

// --- CONFIGURACIÓN DE EMOJIS ---
const ownedEmoji = '<:strawberrity:1411384728119939182>'; 
const missingEmoji = '<:strawberritymissing:1441239270626164847>'; 

module.exports = {
  data: new SlashCommandBuilder()
    .setName('checklist')
    .setDescription('📝 Mira el progreso de tu colección')
    .addUserOption(opt => 
      opt.setName('user')
        .setDescription('¿La checklist de quién quieres ver?')
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
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'group') {
      const { data: groups } = await supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
      const uniqueGroups = [...new Set(groups.map(g => g.group_name))];
      const filtered = uniqueGroups.filter(g => g.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }

    if (focused.name === 'idol') {
      const { data: idols } = await supabase.from('base_cards').select('name');
      const uniqueIdols = [...new Set(idols.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = uniqueIdols.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }
  },

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;
    const groupFilter = interaction.options.getString('group')?.trim();
    const idolFilter = interaction.options.getString('idol')?.trim();

    if (!groupFilter && !idolFilter) {
      return interaction.reply({ 
        content: '⚠️ Por favor, selecciona al menos un **Grupo** o un **Idol**.', 
        ephemeral: true 
      });
    }

    try {
      await interaction.deferReply();

      // 1. OBTENER DATOS
      let baseQuery = supabase
        .from('base_cards')
        .select('id, name, group_name, era, rarity_level')
        .order('name', { ascending: true });

      if (groupFilter) baseQuery = baseQuery.ilike('group_name', `%${groupFilter}%`);
      if (idolFilter) baseQuery = baseQuery.ilike('name', `%${idolFilter}%`);

      const { data: allCards, error: baseError } = await baseQuery;
      if (baseError || !allCards || allCards.length === 0) return interaction.editReply('❌ No se encontraron cartas.');

      const baseIds = allCards.map(c => c.id);
      const { data: ownedCards, error: ownedError } = await supabase
        .from('user_cards')
        .select('card_id')
        .eq('user_id', userId)
        .in('card_id', baseIds);

      if (ownedError) return interaction.editReply('❌ Error al consultar colección.');

      const ownedSet = new Set(ownedCards.map(uc => uc.card_id));

      // 2. PROCESAR Y AGRUPAR
      const dataMap = {};
      allCards.forEach(card => {
        const era = card.era || 'Unknown';
        const cleanName = card.name.split(' — ')[0].trim();
        const rarity = card.rarity_level || 1;

        if (!dataMap[era]) dataMap[era] = {};
        if (!dataMap[era][cleanName]) dataMap[era][cleanName] = { 1: false, 2: false, 3: false };
        if (ownedSet.has(card.id)) dataMap[era][cleanName][rarity] = true;
      });

      const erasArray = Object.entries(dataMap);
      
      // --- LÓGICA DE PAGINACIÓN MEJORADA ---
      let page = 0;
      // Reduje a 6 eras por página para tener espacio si alguna se divide en 2 partes
      const erasPerPage = 6; 

      const generateEmbed = (pageIndex) => {
        const embed = new EmbedBuilder()
            .setColor('#ff9ff3')
            .setAuthor({ name: `Checklist de ${targetUser.username}`, iconURL: targetUser.displayAvatarURL() })
            .setTimestamp();

        if (groupFilter) embed.setTitle(`📂 Checklist: ${groupFilter}`);
        else if (idolFilter) embed.setTitle(`👤 Checklist: ${idolFilter}`);

        const start = pageIndex * erasPerPage;
        const end = start + erasPerPage;
        const currentEras = erasArray.slice(start, end);

        currentEras.forEach(([era, idols]) => {
            const allLines = [];
            for (const [idolName, rarities] of Object.entries(idols)) {
                const r1 = rarities[1] ? ownedEmoji : missingEmoji;
                const r2 = rarities[2] ? ownedEmoji : missingEmoji;
                const r3 = rarities[3] ? ownedEmoji : missingEmoji;
                allLines.push(`${r1}${r2}${r3} **${idolName}**`);
            }

            // --- DIVISIÓN DE CAMPOS SI SUPERA EL LÍMITE DE DISCORD (1024 chars) ---
            // Un emoji mide ~40 chars. 3 emojis + nombre ~150 chars.
            // 1024 chars / 150 = ~6 líneas antes de romperse.
            
            const MAX_CHARS = 1000;
            let currentField = '';
            let part = 1;

            for (let i = 0; i < allLines.length; i++) {
                const line = allLines[i] + '\n';
                
                // Si sumar la línea actual supera el límite, guardamos el campo y empezamos uno nuevo
                if (currentField.length + line.length > MAX_CHARS) {
                    embed.addFields({
                        name: part === 1 ? `💿 Era: ${era}` : `💿 Era: ${era} (Cont.)`,
                        value: currentField,
                        inline: false
                    });
                    currentField = line;
                    part++;
                } else {
                    currentField += line;
                }
            }
            
            // Agregar el último trozo que quedó pendiente
            if (currentField.length > 0) {
                embed.addFields({
                    name: part === 1 ? `💿 Era: ${era}` : `💿 Era: ${era} (Cont.)`,
                    value: currentField,
                    inline: false
                });
            }
        });

        const totalSlots = allCards.length;
        const filledSlots = ownedSet.size;
        const percent = Math.round((filledSlots / totalSlots) * 100);
        const totalPages = Math.ceil(erasArray.length / erasPerPage);

        embed.setFooter({ text: `Página ${pageIndex + 1}/${totalPages} • Progreso: ${percent}%` });
        return embed;
      };

      const generateButtons = (idx) => {
          const totalPages = Math.ceil(erasArray.length / erasPerPage);
          const row = new ActionRowBuilder();
          row.addComponents(
              new ButtonBuilder().setCustomId('prev').setLabel('⬅️').setStyle(ButtonStyle.Primary).setDisabled(idx === 0),
              new ButtonBuilder().setCustomId('next').setLabel('➡️').setStyle(ButtonStyle.Primary).setDisabled(idx >= totalPages - 1)
          );
          return row;
      };

      const msg = await interaction.editReply({ 
          embeds: [generateEmbed(page)], 
          components: erasArray.length > erasPerPage ? [generateButtons(page)] : [] 
      });

      if (erasArray.length <= erasPerPage) return;

      const collector = msg.createMessageComponentCollector({
          time: 120000,
          filter: i => i.user.id === interaction.user.id
      });

      collector.on('collect', async i => {
          if (i.customId === 'prev') page--;
          if (i.customId === 'next') page++;
          await i.update({ embeds: [generateEmbed(page)], components: [generateButtons(page)] });
      });

      collector.on('end', async () => {
          try {
              const row = generateButtons(page);
              row.components.forEach(b => b.setDisabled(true));
              await msg.edit({ components: [row] });
          } catch (e) {}
      });

    } catch (err) {
      console.error(err);
      if (!interaction.replied) await interaction.editReply('❌ Error interno.');
    }
  }
};
