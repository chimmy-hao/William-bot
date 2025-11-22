const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  AttachmentBuilder 
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN ---
const strawberryEmoji = '<:strawberrity:1411384728119939182>'; 

// ID DEL BOT (Debe estar en tus variables de entorno en Render como CLIENT_ID)
const BOT_ID = process.env.CLIENT_ID; 

// Helper para generar ID
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

// Helper para emojis
const getRarityEmoji = (level) => {
  if (level === 1) return strawberryEmoji;
  if (level === 2) return `${strawberryEmoji}${strawberryEmoji}`;
  if (level === 3) return `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`;
  return strawberryEmoji;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level_up')
    .setDescription('⬆️ Combina 10 cartas de una rareza para obtener 1 de la siguiente')
    .addStringOption(opt =>
      opt.setName('codes')
        .setDescription('MODO MANUAL: Pega 10 códigos exactos separados por espacio')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('rarity')
        .setDescription('MODO AUTO: ¿Qué rareza quieres combinar? (1 o 2)')
        .setMinValue(1)
        .setMaxValue(2)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('idol')
        .setDescription('MODO AUTO: Elige el idol')
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('group')
        .setDescription('MODO AUTO: Elige el grupo')
        .setAutocomplete(true)
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const focusName = interaction.options.getFocused(true).name;

    if (focusName === 'group') {
      const { data } = await supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
      const unique = [...new Set(data.map(g => g.group_name))];
      const filtered = unique.filter(g => g.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }
    
    if (focusName === 'idol') {
      const { data } = await supabase.from('base_cards').select('name');
      const unique = [...new Set(data.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = unique.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    const codesInput = interaction.options.getString('codes');
    const targetRarityBase = interaction.options.getInteger('rarity');
    const idolFilter = interaction.options.getString('idol');
    const groupFilter = interaction.options.getString('group');

    if (!codesInput && (!targetRarityBase || !idolFilter)) {
      return interaction.reply({ content: '⚠️ Debes usar el **Modo Manual** (escribiendo 10 códigos) o el **Modo Auto** (seleccionando Rareza e Idol).', ephemeral: true });
    }

    // Verificación crítica: Si no hay CLIENT_ID configurado, avisar
    if (!BOT_ID) {
        return interaction.reply({ content: '❌ Error de configuración: Falta la variable `CLIENT_ID` en Render para el Pool de Cartas.', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      let cardsToConsume = [];

      // --- MODO 1: MANUAL ---
      if (codesInput) {
        const codesArr = [...new Set(codesInput.split(/[\s,]+/).filter(c => c))];
        
        if (codesArr.length !== 10) {
          return interaction.editReply(`❌ Debes proporcionar exactamente **10 códigos únicos**. Has escrito ${codesArr.length}.`);
        }

        const { data: foundCards, error } = await supabase
          .from('user_cards')
          .select(`id, unique_card_id, rarity, base_cards!inner (id, name, group_name, era, rarity_level, image_url, card_code)`)
          .eq('user_id', userId)
          .in('unique_card_id', codesArr);

        if (error || !foundCards || foundCards.length !== 10) {
          return interaction.editReply('❌ Error: No posees todas esas cartas o los códigos son incorrectos.');
        }

        cardsToConsume = foundCards;
      } 
      
      // --- MODO 2: AUTO ---
      else {
        let query = supabase
          .from('user_cards')
          .select(`id, unique_card_id, rarity, base_cards!inner (id, name, group_name, era, rarity_level, image_url, card_code)`)
          .eq('user_id', userId)
          .eq('rarity', targetRarityBase);

        if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);
        if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);

        const { data: potentialCards, error } = await query;

        if (error || !potentialCards || potentialCards.length < 10) {
          return interaction.editReply(`❌ No tienes suficientes cartas (Rareza ${targetRarityBase}) con esos filtros para realizar un Level Up. Necesitas 10.`);
        }

        const groups = {};
        for (const c of potentialCards) {
            const key = `${c.base_cards.name}_${c.base_cards.era}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(c);
        }

        let validGroup = null;
        for (const key in groups) {
            if (groups[key].length >= 10) {
                validGroup = groups[key].slice(0, 10);
                break;
            }
        }

        if (!validGroup) {
            return interaction.editReply('❌ Tienes cartas, pero no completas 10 del **mismo Idol y misma Era**.');
        }

        cardsToConsume = validGroup;
      }

      // --- VALIDACIÓN FINAL ---
      const firstCard = cardsToConsume[0];
      const currentRarity = firstCard.rarity;
      const currentEra = firstCard.base_cards.era;
      const currentIdolName = firstCard.base_cards.name;
      const currentGroup = firstCard.base_cards.group_name;

      const allMatch = cardsToConsume.every(c => 
        c.rarity === currentRarity && 
        c.base_cards.era === currentEra && 
        c.base_cards.name === currentIdolName
      );

      if (!allMatch) {
        return interaction.editReply('❌ Todas las 10 cartas deben ser del **mismo Idol, misma Era y misma Rareza**.');
      }

      if (currentRarity >= 3) {
        return interaction.editReply('❌ Las cartas de Rareza 3 (Legendarias) ya están en el nivel máximo.');
      }

      const nextRarity = currentRarity + 1;
      
      const { data: targetBaseCard, error: targetError } = await supabase
        .from('base_cards')
        .select('*')
        .eq('name', currentIdolName)
        .eq('group_name', currentGroup)
        .eq('era', currentEra)
        .eq('rarity_level', nextRarity)
        .single();

      if (targetError || !targetBaseCard) {
        return interaction.editReply(`❌ Error: No existe una versión de **Rareza ${nextRarity}** para esta carta en la base de datos.`);
      }

      // --- EJECUCIÓN (TRANSFER TO BOT POOL & MINT) ---
      
      // 1. ASEGURAR QUE EL BOT EXISTA EN LA DB
      // Esto evita el error de Foreign Key Constraint
      await supabase.from('users').upsert({ 
          user_id: BOT_ID, 
          username: 'William Bot (Pool)', 
          balance: 0 
      });

      // 2. TRANSFERIR CARTAS AL BOT
      const idsToBurn = cardsToConsume.map(c => c.id);

      const { error: transferError } = await supabase
        .from('user_cards')
        .update({ user_id: BOT_ID }) // Se las damos al bot
        .in('id', idsToBurn);

      if (transferError) {
        console.error(transferError);
        return interaction.editReply('❌ Error crítico al transferir las cartas al Pool del Bot.');
      }

      // 3. CREAR NUEVA CARTA
      const newUniqueId = generateUniqueCardCode(targetBaseCard.card_code);
      
      const { error: mintError } = await supabase
        .from('user_cards')
        .insert({
            user_id: userId,
            card_id: targetBaseCard.id,
            rarity: nextRarity,
            unique_card_id: newUniqueId
        });

      if (mintError) {
        console.error(mintError);
        return interaction.editReply('❌ Error al crear la nueva carta.');
      }

      // --- VISUALIZACIÓN ---
      let attachment = null;
      try {
        const img = await loadImage(targetBaseCard.image_url);
        
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        const radius = 20; 

        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(img.width - radius, 0);
        ctx.quadraticCurveTo(img.width, 0, img.width, radius);
        ctx.lineTo(img.width, img.height - radius);
        ctx.quadraticCurveTo(img.width, img.height, img.width - radius, img.height);
        ctx.lineTo(radius, img.height);
        ctx.quadraticCurveTo(0, img.height, 0, img.height - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.clip(); 

        ctx.drawImage(img, 0, 0); 
        
        attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'levelup.png' });
      } catch (e) {
        console.error("Error cargando imagen canvas", e);
      }

      const cleanName = targetBaseCard.name.split(' — ')[0].trim();
      const oldEmoji = getRarityEmoji(currentRarity);
      const newEmoji = getRarityEmoji(nextRarity);

      const embed = new EmbedBuilder()
        .setColor('#9b59b6')
        .setTitle('✨ ¡LEVEL UP COMPLETADO! ✨')
        .setDescription(
            `Has combinado **10 cartas** de ${cleanName} (${oldEmoji}) para obtener su versión superior.` +
            `\n\n🔥 **Cartas consumidas:** 10\n🌟 **Nueva Rareza:** ${newEmoji}\n🆔 **Nuevo Código:** \`${newUniqueId}\``
        )
        .setFooter({ text: 'Las cartas usadas se han enviado al Pool del Bot.' });

      if (attachment) {
        embed.setImage('attachment://levelup.png');
        await interaction.editReply({ embeds: [embed], files: [attachment] });
      } else {
        embed.setImage(targetBaseCard.image_url);
        await interaction.editReply({ embeds: [embed] });
      }

    } catch (err) {
      console.error('Error en level_up:', err);
      await interaction.editReply('❌ Ocurrió un error inesperado.');
    }
  }
};
