const { SlashCommandBuilder } = require('discord.js'); 
const { createClient } = require('@supabase/supabase-js');

// Importar configuración de packs
const packConfigs = require('../packs'); 

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Función para generar código único
function generateUniqueCardCode(cardCode) {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${cardCode}.${randomSuffix}`;
}

// Helper para mayúsculas
const capitalize = (s) => s && s.charAt(0).toUpperCase() + s.slice(1);

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

  // --- AUTOCOMPLETE ---
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
      const { data: groups } = await supabase.from('base_cards').select('group_name').not('group_name', 'is', null).eq('is_active', true);
      const uniqueGroups = [...new Set(groups.map(g => g.group_name))];
      const filtered = uniqueGroups.filter(g => g.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }
    if (focused.name === 'idol') {
      const { data: idols } = await supabase.from('base_cards').select('name').eq('is_active', true);
      const uniqueIdols = [...new Set(idols.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = uniqueIdols.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }
  },

  // --- EXECUTE ---
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

    // Validaciones Específicas
    if (pack.code === "orange" && !grupo) {
        return interaction.reply({ content: '❌ Debes elegir un grupo para abrir un Orange Pack.', ephemeral: true });
    }
    if (pack.code === "strawberry" && (!grupo || !idol)) {
        return interaction.reply({ content: '❌ Debes elegir grupo e idol para abrir un Strawberry Pack.', ephemeral: true });
    }

    await interaction.deferReply();

    const packConfig = packConfigs[pack.code]; 
    if (!packConfig) return interaction.editReply('❌ Error de configuración interna del pack.');

    let cardsToGive = [];

    // 2. BUSCAR CARTAS
    try {
        // A. LÓGICA ESPECIAL: PACK DE EVENTOS (Fruit Drops)
        if (packConfig.type === 'random3_event') {
             for (let i = 0; i < 3; i++) {
                const { data: eventCards } = await supabase
                    .from('base_cards')
                    .select('*')
                    .not('event_type', 'is', null) 
                    .eq('is_active', true);
                
                if (eventCards && eventCards.length > 0) {
                    cardsToGive.push(eventCards[Math.floor(Math.random() * eventCards.length)]);
                }
             }

        // B. LÓGICA ESTÁNDAR
        } else {
            let iterations = [];
            
            if (packConfig.type === 'random5_group' || packConfig.type === 'random5_group_idol') {
                for(let i=0; i<5; i++) iterations.push(Math.floor(Math.random() * 3) + 1);
            } else if (packConfig.config) {
                for (const item of packConfig.config) {
                    for (let i=0; i < item.count; i++) iterations.push(item.rarity);
                }
            }

            for (const rarity of iterations) {
                let query = supabase.from('base_cards').select('*')
                    .eq('rarity_level', rarity)
                    .eq('is_active', true)
                    // SEGURIDAD: Que NO sean de evento
                    .or('event_type.is.null,event_type.eq.""'); 

                if (grupo) query = query.eq('group_name', grupo);
                if (idol) query = query.ilike('name', `%${idol}%`); 

                const { data: cards } = await query;
                if (cards && cards.length > 0) {
                    cardsToGive.push(cards[Math.floor(Math.random() * cards.length)]);
                }
            }
        }

    } catch (error) {
        console.error("Error buscando cartas:", error);
        return interaction.editReply({ content: '❌ Hubo un error al buscar las cartas. Tu pack no ha sido consumido.' });
    }

    // 3. VERIFICAR RESULTADO
    if (cardsToGive.length === 0) {
      return interaction.editReply({ 
        content: `❌ **No se pudieron obtener cartas.**\nPosibles razones:\n- No hay cartas disponibles o activas.\n\n🔒 **Tu pack ${pack.name} NO se ha gastado.**`, 
        ephemeral: true 
      });
    }

    // 4. CONSUMIR PACK Y ENTREGAR
    await supabase.from('user_packs').update({ quantity: userPack.quantity - 1 }).eq('id', userPack.id);

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

    // Historial
    await supabase.from('history_logs').insert({
        user_id: userId,
        action_type: 'pack_open',
        details: `Abrió ${pack.name}. Obtuvo ${finalCards.length} cartas.`
    });

    // 5. MOSTRAR RESULTADO (FORMATO PERSONALIZADO)
    const rarityEmoji = '<:strawberrity:1411384728119939182>';
    const eventEmoji = '<:strawvent:1462665407218585620>'; // Nuevo Emoji de Evento

    const cardList = finalCards.map(c => {
      const cleanName = c.name.split(' — ')[0].trim();
      const groupDisplay = c.group_name || 'Solista';

      // --- SI ES EVENTO (Fruit Drops) ---
      if (c.event_type && c.event_type.trim() !== "") {
          // Usamos 'era' si existe (porque ahí guardamos el nombre lindo "Halloween"), 
          // si no, capitalizamos el event_type ("halloween" -> "Halloween")
          const eventName = c.era || capitalize(c.event_type);
          
          return `${eventEmoji} ${eventEmoji}**${cleanName}** — ${groupDisplay} (${eventName})\nCode: \`${c.unique_card_id}\``;
      } 
      
      // --- SI ES NORMAL ---
      else {
          const typeDisplay = rarityEmoji.repeat(c.rarity_level || 1);
          return `${typeDisplay} **${cleanName}** — ${groupDisplay} (Era ${c.era || 'Original'})\nCode: \`${c.unique_card_id}\``;
      }

    }).join('\n\n');

    return interaction.editReply(`🎉 ${interaction.user.username} abrió ${pack.emoji} ${pack.name} y consiguió:\n\n${cardList}`);
  }
};
