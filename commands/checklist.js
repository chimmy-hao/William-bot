const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN DE EMOJIS ---
const ownedEmoji = '<:strawberrity:1411384728119939182>'; // Fresa normal (La tienes)
const missingEmoji = '<:strawberritymissing:1441239270626164847>'; // Fresa gris (Te falta)

module.exports = {
  data: new SlashCommandBuilder()
    .setName('checklist')
    .setDescription('📝 Mira qué cartas te faltan para completar tu colección')
    .addUserOption(opt => 
      opt.setName('user')
        .setDescription('¿La checklist de quién quieres ver?')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('group')
        .setDescription('Filtrar por grupo (Recomendado)')
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
      // Limpiamos nombres para el buscador
      const uniqueIdols = [...new Set(idols.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = uniqueIdols.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }
  },

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;
    const groupFilter = interaction.options.getString('group');
    const idolFilter = interaction.options.getString('idol');

    // Validación: Pedir al menos un filtro
    if (!groupFilter && !idolFilter) {
      return interaction.reply({ 
        content: '⚠️ Por favor, selecciona al menos un **Grupo** o un **Idol** para generar la checklist.', 
        ephemeral: true 
      });
    }

    try {
      await interaction.deferReply();

      // 1. Obtener TODAS las cartas base (Lo que EXISTE)
      let baseQuery = supabase
        .from('base_cards')
        .select('id, name, group_name, era, rarity_level')
        .order('name', { ascending: true });

      if (groupFilter) baseQuery = baseQuery.ilike('group_name', `%${groupFilter}%`);
      if (idolFilter) baseQuery = baseQuery.ilike('name', `%${idolFilter}%`);

      const { data: allCards, error: baseError } = await baseQuery;

      if (baseError || !allCards || allCards.length === 0) {
        return interaction.editReply('❌ No se encontraron cartas con esos filtros.');
      }

      // 2. Obtener las cartas que TIENE el usuario (Lo que POSEE)
      const baseIds = allCards.map(c => c.id);
      const { data: ownedCards, error: ownedError } = await supabase
        .from('user_cards')
        .select('card_id')
        .eq('user_id', userId)
        .in('card_id', baseIds);

      if (ownedError) {
        console.error(ownedError);
        return interaction.editReply('❌ Error al consultar tu colección.');
      }

      const ownedSet = new Set(ownedCards.map(uc => uc.card_id));

      // 3. PROCESAR DATOS
      const dataMap = {};

      allCards.forEach(card => {
        const era = card.era || 'Unknown Era';
        const cleanName = card.name.split(' — ')[0].trim();
        const rarity = card.rarity_level || 1;

        if (!dataMap[era]) dataMap[era] = {};
        if (!dataMap[era][cleanName]) dataMap[era][cleanName] = { 1: false, 2: false, 3: false };

        if (ownedSet.has(card.id)) {
          dataMap[era][cleanName][rarity] = true;
        }
      });

      // 4. CONSTRUIR EL EMBED
      const embed = new EmbedBuilder()
        .setColor('#ff9ff3')
        .setAuthor({ 
          name: `${targetUser.username}'s Checklist`, 
          iconURL: targetUser.displayAvatarURL() 
        })
        .setTimestamp();

      if (groupFilter) embed.setTitle(`📂 Checklist: ${groupFilter}`);
      else if (idolFilter) embed.setTitle(`👤 Checklist: ${idolFilter}`);

      let fieldCount = 0;
      for (const [era, idols] of Object.entries(dataMap)) {
        if (fieldCount >= 25) break; 

        const lines = [];
        for (const [idolName, rarities] of Object.entries(idols)) {
          // Aquí usamos tus emojis
          const r1 = rarities[1] ? ownedEmoji : missingEmoji;
          const r2 = rarities[2] ? ownedEmoji : missingEmoji;
          const r3 = rarities[3] ? ownedEmoji : missingEmoji;

          lines.push(`${r1}${r2}${r3} **${idolName}**`);
        }

        if (lines.length > 0) {
          embed.addFields({
            name: `💿 Era: ${era}`,
            value: lines.join('\n'),
            inline: false
          });
          fieldCount++;
        }
      }

      // Pie de página
      const totalBase = allCards.length;
      const totalOwned = ownedCards.length;
      const percent = Math.round((totalOwned / totalBase) * 100);

      embed.setFooter({ 
        text: `Progreso: ${totalOwned}/${totalBase} (${percent}%) • ${ownedEmoji}=Tienes • ${missingEmoji}=Falta` 
      });

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error en checklist:', err);
      await interaction.editReply('❌ Ocurrió un error al generar la checklist.');
    }
  }
};
