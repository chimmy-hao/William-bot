const { SlashCommandBuilder } = require('discord.js'); 
const { createClient } = require('@supabase/supabase-js');

// Importar configuración de packs
// Asegúrate de que la ruta sea correcta según tu estructura de carpetas
const packConfigs = require('../packs'); 

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Función para generar código único
function generateUniqueCardCode(cardCode) {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
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
        return { name: `${p.name} (${qty})`, value: p.code };
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
      // Limpiamos el nombre para que el usuario vea "Win Metawin" y no "Win Metawin — Solista"
      const uniqueIdols = [...new Set(idols.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = uniqueIdols.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    const packCode = interaction.options.getString('pack');
    const grupo = interaction.options.getString('grupo');
    const idol = interaction.options.getString('idol');

    // 1. Validar existencia del pack y posesión
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

    // Validaciones de Pack Específico (Orange/Strawberry)
    if (pack.code === "orange" && !grupo) {
        return interaction.reply({ content: '❌ Debes elegir un grupo para abrir un Orange Pack.', ephemeral: true });
    }
    if (pack.code === "strawberry" && (!grupo || !idol)) {
        return interaction.reply({ content: '❌ Debes elegir grupo e idol para abrir un Strawberry Pack.', ephemeral: true });
    }

    await interaction.deferReply();

    const giveConfig = packConfigs[pack.code];
    let cardsToGive = [];

    // 2. BUSCAR CARTAS (Sin gastar el pack todavía)
    try {
        if (giveConfig === "random5") {
            for (let i = 0; i < 5; i++) {
                const rarity = Math.floor(Math.random() * 3) + 1;
                let query = supabase.from('base_cards').select('*').eq('rarity_level', rarity);

                if (grupo) query = query.eq('group_name', grupo);
                
                // --- CORRECCIÓN AQUÍ ---
                // Usamos ilike con % para que "Win Metawin" encuentre "Win Metawin — Solista"
                if (idol) query = query.ilike('name', `%${idol}%`); 

                const { data: cards } = await query;
                if (cards && cards.length > 0) {
                    cardsToGive.push(cards[Math.floor(Math.random() * cards.length)]);
                }
            }
        } else {
            // Packs fijos (Como el Strawberry que suele dar rarezas altas fijas)
            for (const { rarity, count } of giveConfig) {
                let query = supabase.from('base_cards').select('*').eq('rarity_level', rarity);
                if (grupo) query = query.eq('group_name', grupo);
                
                // --- CORRECCIÓN AQUÍ TAMBIÉN ---
                if (idol) query = query.ilike('name', `%${idol}%`);

                const { data: cards } = await query;

                if (cards && cards.length > 0) {
                    for (let i = 0; i < count; i++) {
                        cardsToGive.push(cards[Math.floor(Math.random() * cards.length)]);
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error buscando cartas:", error);
        return interaction.editReply({ content: '❌ Hubo un error al buscar las cartas. Tu pack no ha sido consumido.' });
    }

    // 3. VERIFICAR RESULTADO
    if (cardsToGive.length === 0) {
      return interaction.editReply({ content: '❌ No se pudieron obtener cartas con esos filtros (o el grupo/idol no tiene cartas de la rareza que da este pack). Tu pack está a salvo.', ephemeral: true });
    }

    // 4. CONSUMIR PACK Y ENTREGAR CARTAS
    // A) Restar pack
    await supabase.from('user_packs').update({ quantity: userPack.quantity - 1 }).eq('id', userPack.id);

    // B) Insertar cartas en DB
    const finalCards = [];
    for (const card of cardsToGive) {
        const uniqueCode = generateUniqueCardCode(card.card_code);
        finalCards.push({ ...card, unique_card_id: uniqueCode });

        await supabase.from('user_cards').insert([{
            user_id: userId,
            card_id: card.id,
            rarity: card.rarity_level,
            unique_card_id: uniqueCode
        }]);
    }

    // 5. MOSTRAR RESULTADO
    const rarityEmoji = '<:strawberrity:1411384728119939182>';
    const cardList = finalCards.map(c => {
      const emojiRarity = rarityEmoji.repeat(c.rarity_level || 1);
      const cleanName = c.name.split(' — ')[0].trim();
      return `${emojiRarity} **${cleanName}** — ${c.group_name || 'sin grupo'} (Era ${c.era || 'desconocida'})\nCode: \`${c.unique_card_id}\``;
    }).join('\n\n');

    return interaction.editReply(`🎉 ${interaction.user.username} abrió ${pack.emoji} ${pack.name} y consiguió:\n\n${cardList}`);
  }
};
