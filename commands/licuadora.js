const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// --- CONEXIÓN SUPABASE ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN DE RECETAS ---
const RECIPES = {
  banana: {
    name: 'Banana Pack',
    emoji: '<:pack_banana:1413292531134759053>',
    required: { 1: 8, 2: 2, 3: 0 } // 8 1s, 2 2s, 0 3s
  },
  grape: {
    name: 'Grape Pack',
    emoji: '<:pack_grape:1413292369675157655>',
    required: { 1: 4, 2: 6, 3: 0 }
  },
  kiwi: {
    name: 'Kiwi Pack',
    emoji: '<:pack_kiwi:1413292487455408201>',
    required: { 1: 4, 2: 4, 3: 2 }
  }
};

// --- COOLDOWN ---
const cooldowns = new Map();
const MAX_USES = 3;
const COOLDOWN_TIME = 12 * 60 * 60 * 1000; // 12 Horas

module.exports = {
  data: new SlashCommandBuilder()
    .setName('licuadora')
    .setDescription('🌪️ Recicla tus cartas para obtener un pack.')
    .addStringOption(option =>
      option.setName('codes')
        .setDescription('Los códigos de las cartas a sacrificar (separados por espacio)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const botId = interaction.client.user.id;
    const codesInput = interaction.options.getString('codes');

    // 1. GESTIÓN DE COOLDOWN
    const now = Date.now();
    let userData = cooldowns.get(userId) || { uses: 0, expiresAt: 0 };

    if (userData.uses >= MAX_USES) {
      if (now < userData.expiresAt) {
        const remaining = userData.expiresAt - now;
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        return interaction.reply({ 
          content: `⏳ **La licuadora se está enfriando.** Vuelve en **${hours}h ${mins}m**.`, 
          ephemeral: true 
        });
      } else {
        // Reset cooldown
        userData = { uses: 0, expiresAt: 0 };
      }
    }

    await interaction.deferReply();

    try {
      // 2. PROCESAR CÓDIGOS
      const codeList = codesInput.split(/[\s,]+/).filter(c => c.length > 0);
      const uniqueCodes = [...new Set(codeList)];

      if (uniqueCodes.length === 0) return interaction.editReply('❌ No ingresaste ningún código válido.');

      // 3. BUSCAR CARTAS EN SUPABASE
      const { data: cards, error } = await supabase
        .from('user_cards')
        .select('id, unique_card_id, rarity') 
        .eq('user_id', userId)
        .in('unique_card_id', uniqueCodes);

      if (error) throw error;

      if (!cards || cards.length !== uniqueCodes.length) {
        return interaction.editReply(`❌ **Error:** Alguna de las cartas no existe o no te pertenece. Verificaste ${uniqueCodes.length} códigos pero solo encontré ${cards ? cards.length : 0}.`);
      }

      // 4. CONTAR RAREZAS
      const counts = { 1: 0, 2: 0, 3: 0 };
      cards.forEach(card => {
        const r = card.rarity || 1; 
        if (counts[r] !== undefined) counts[r]++;
      });

      // 5. VERIFICAR SI COINCIDE CON ALGUNA RECETA
      let matchedPack = null;

      for (const [key, recipe] of Object.entries(RECIPES)) {
        const r = recipe.required;
        if (counts[1] === r[1] && counts[2] === r[2] && counts[3] === r[3]) {
          matchedPack = key;
          break; 
        }
      }

      if (!matchedPack) {
        return interaction.editReply({
          content: `❌ **Mezcla Incorrecta.** Los ingredientes no coinciden con ningún Pack.\n\n` +
                   `**Ingresaste:** ${counts[1]}x 1s | ${counts[2]}x 2s | ${counts[3]}x 3s\n\n` +
                   `📜 **Recetas:**\n` +
                   `🍌 **Banana:** 8x 1s + 2x 2s\n` +
                   `🍇 **Grape:** 4x 1s + 6x 2s\n` +
                   `🥝 **Kiwi:** 4x 1s + 4x 2s + 2x 3s`
        });
      }

      const recipe = RECIPES[matchedPack];

      // 6. EJECUTAR EL INTERCAMBIO
      
      // A) Mover cartas al Bot
      const cardIds = cards.map(c => c.id);
      const { error: moveError } = await supabase
        .from('user_cards')
        .update({ user_id: botId })
        .in('id', cardIds);
      
      if (moveError) throw moveError;

      // B) Dar el Pack al Usuario
      const { data: currentPack } = await supabase
        .from('user_packs')
        .select('amount')
        .eq('user_id', userId)
        .eq('pack_name', matchedPack)
        .single();

      const newAmount = (currentPack?.amount || 0) + 1;

      // Upsert especificando la clave de conflicto para evitar errores en Supabase
      const { error: packError } = await supabase
        .from('user_packs')
        .upsert(
            { user_id: userId, pack_name: matchedPack, amount: newAmount },
            { onConflict: 'user_id, pack_name' }
        );

      if (packError) throw packError;

      // 7. ACTUALIZAR COOLDOWN Y CONFIRMAR
      userData.uses += 1;
      if (userData.uses >= MAX_USES) userData.expiresAt = now + COOLDOWN_TIME;
      cooldowns.set(userId, userData);

      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle(`🌪️ ¡Licuadora Completada!`)
        .setDescription(`Has triturado **${cards.length} cartas** correctamente.`)
        .addFields(
          { name: 'Resultado', value: `Obtuviste 1x ${recipe.emoji} **${recipe.name}**` },
          { name: 'Inventario', value: 'El pack se ha guardado en tu inventario.' }
        )
        .setFooter({ text: `Usos restantes hoy: ${MAX_USES - userData.uses}` });

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      interaction.editReply('❌ Ocurrió un error en la licuadora (Base de datos).');
    }
  }
};
