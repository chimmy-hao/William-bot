const { SlashCommandBuilder } = require('discord.js'); 
const { createClient } = require('@supabase/supabase-js');

// Importar configuración de packs
const packConfigs = require('../packs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// === FUNCION NUEVA: generar unique_card_id ===
function generateUniqueCardCode(cardCode) {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000); // número aleatorio de 4 dígitos
  return `${cardCode}.${randomSuffix}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('🎁 Usa un pack de tu inventario')
    .addStringOption(opt =>
      opt.setName('pack')
        .setDescription('Elige un pack para abrir')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('grupo')
        .setDescription('Filtrar por grupo (opcional)')
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('idol')
        .setDescription('Filtrar por idol (opcional)')
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const userId = interaction.user.id;

    if (focused.name === 'pack') {
      const { data: userPacks } = await supabase
        .from('user_packs')
        .select('quantity, pack_code')
        .eq('user_id', userId)
        .gt('quantity', 0);

      if (!userPacks || userPacks.length === 0) return interaction.respond([]);

      const { data: packs } = await supabase
        .from('packs')
        .select('code, name, emoji')
        .in('code', userPacks.map(up => up.pack_code));

      const choices = packs.map(p => {
        const qty = userPacks.find(up => up.pack_code === p.code)?.quantity || 0;
        return { name: `${p.emoji} ${p.name} (${qty})`, value: p.code };
      });

      const filtered = choices.filter(c => c.name.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered);
    }

    if (focused.name === 'grupo') {
      const { data: groups } = await supabase
        .from('base_cards')
        .select('group_name')
        .not('group_name', 'is', null);

      const uniqueGroups = [...new Set(groups.map(g => g.group_name))];
      const filtered = uniqueGroups.filter(g => g.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }

    if (focused.name === 'idol') {
      const { data: idols } = await supabase.from('base_cards').select('name');
      const uniqueIdols = [...new Set(idols.map(i => i.name))];
      const filtered = uniqueIdols.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    const packCode = interaction.options.getString('pack');
    const grupo = interaction.options.getString('grupo');
    const idol = interaction.options.getString('idol');

    const { data: pack } = await supabase.from('packs').select('*').eq('code', packCode).single();
    if (!pack) return interaction.reply({ content: '❌ Ese pack no existe.', ephemeral: true });

    const { data: userPack } = await supabase
      .from('user_packs')
      .select('*')
      .eq('user_id', userId)
      .eq('pack_code', pack.code)
      .single();

    if (!userPack || userPack.quantity <= 0) {
      return interaction.reply({ content: '❌ No tienes ese pack en tu inventario.', ephemeral: true });
    }

    await supabase.from('user_packs').update({ quantity: userPack.quantity - 1 }).eq('id', userPack.id);

    const giveConfig = packConfigs[pack.code];
    const cardsGiven = [];

    if (giveConfig === "random5") {
      for (let i = 0; i < 5; i++) {
        const rarity = Math.floor(Math.random() * 3) + 1;
        let query = supabase.from('base_cards').select('*').eq('rarity_level', rarity);

        if (pack.code === "orange" && !grupo) {
          return interaction.reply({ content: '❌ Debes elegir un grupo para abrir un Orange Pack.', ephemeral: true });
        }
        if (pack.code === "strawberry" && (!grupo || !idol)) {
          return interaction.reply({ content: '❌ Debes elegir grupo e idol para abrir un Strawberry Pack.', ephemeral: true });
        }

        if (grupo) query = query.eq('group_name', grupo);
        if (idol) query = query.eq('name', idol);

        const { data: cards } = await query;
        if (!cards || cards.length === 0) continue;

        const randomCard = cards[Math.floor(Math.random() * cards.length)];
        const uniqueCode = generateUniqueCardCode(randomCard.card_code);
        cardsGiven.push({ ...randomCard, unique_card_id: uniqueCode });

        await supabase.from('user_cards').insert([{
          user_id: userId,
          card_id: randomCard.id,
          rarity: randomCard.rarity_level,
          unique_card_id: uniqueCode
        }]);
      }
    } else {
      for (const { rarity, count } of giveConfig) {
        let query = supabase.from('base_cards').select('*').eq('rarity_level', rarity);
        if (grupo) query = query.eq('group_name', grupo);
        if (idol) query = query.eq('name', idol);
        const { data: cards } = await query;

        if (!cards || cards.length === 0) continue;

        for (let i = 0; i < count; i++) {
          const randomCard = cards[Math.floor(Math.random() * cards.length)];
          const uniqueCode = generateUniqueCardCode(randomCard.card_code);
          cardsGiven.push({ ...randomCard, unique_card_id: uniqueCode });

          await supabase.from('user_cards').insert([{
            user_id: userId,
            card_id: randomCard.id,
            rarity: randomCard.rarity_level,
            unique_card_id: uniqueCode
          }]);
        }
      }
    }

    if (cardsGiven.length === 0) {
      return interaction.reply({ content: '❌ No se pudieron obtener cartas con esos filtros.', ephemeral: true });
    }

    // === CAMBIO: mostrar unique_card_id en lugar de card_code ===
    const rarityEmoji = '<:strawberrity:1411384728119939182>';
    const cardList = cardsGiven.map(c => {
      const emojiRarity = rarityEmoji.repeat(c.rarity_level || 1);
      return `${emojiRarity} ${c.name} — ${c.group_name || 'sin grupo'} (Era ${c.era || 'desconocida'})\nCode: ${c.unique_card_id}`;
    }).join('\n');

    return interaction.reply(`🎉 ${interaction.user.username} abrió ${pack.emoji} ${pack.name} y consiguió:\n${cardList}`);
  }
};

