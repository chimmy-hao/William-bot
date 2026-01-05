const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// --- CONEXIÓN SUPABASE ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN DE RECETAS ---
// NOTA: Si cambias algo aquí, recuerda cambiarlo también en recetas.js visualmente
const RECIPES = {
  banana: {
    name: 'Banana Pack',
    emoji: '<:pack_banana:1413292531134759053>',
    required: { 1: 8, 2: 2, 3: 0 } 
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

const MAX_USES = 3;
const COOLDOWN_TIME = 12 * 60 * 60 * 1000; // 12 Horas

module.exports = {
  data: new SlashCommandBuilder()
    .setName('licuadora')
    .setDescription('🌪️ Recicla tus cartas para obtener un pack. (Ver recetas: /recetas)') // <--- Mención aquí
    .addStringOption(option =>
      option.setName('codes')
        .setDescription('Los códigos de las cartas (separados por espacio)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const botId = interaction.client.user.id;
    const codesInput = interaction.options.getString('codes');
    const now = Date.now();

    // 1. GESTIÓN DE COOLDOWN
    let { data: user } = await supabase
        .from('users')
        .select('licuadora_uses, licuadora_reset_time')
        .eq('user_id', userId)
        .single();
    
    let uses = user?.licuadora_uses || 0;
    let expiresAt = user?.licuadora_reset_time || 0;

    if (now > expiresAt) {
        uses = 0;
        expiresAt = 0; 
    }

    if (uses >= MAX_USES) {
        const remaining = expiresAt - now;
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        return interaction.reply({ 
          content: `⏳ **La licuadora se está enfriando.** Vuelve en **${hours}h ${mins}m**.`, 
          ephemeral: true 
        });
    }

    await interaction.deferReply();

    try {
      // 2. LÓGICA DEL COMANDO
      const codeList = codesInput.split(/[\s,]+/).filter(c => c.length > 0);
      const uniqueCodes = [...new Set(codeList)];

      if (uniqueCodes.length === 0) return interaction.editReply('❌ No ingresaste ningún código válido.');

      // 3. BUSCAR CARTAS
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

      // 5. VERIFICAR RECETA
      let matchedPack = null;
      let matchedPackKey = null;

      for (const [key, recipe] of Object.entries(RECIPES)) {
        const r = recipe.required;
        if (counts[1] === r[1] && counts[2] === r[2] && counts[3] === r[3]) {
          matchedPack = recipe;
          matchedPackKey = key;
          break; 
        }
      }

      if (!matchedPack) {
        return interaction.editReply({
          content: `❌ **Mezcla Incorrecta.**\n\n` +
                   `**Ingresaste:** ${counts[1]}x R1 | ${counts[2]}x R2 | ${counts[3]}x R3\n` +
                   `💡 _Usa \`/recetas\` para ver las combinaciones exactas._` // <--- Mención aquí
        });
      }

      const recipe = matchedPack;

      // 6. EJECUTAR EL INTERCAMBIO
      const cardIds = cards.map(c => c.id);
      const { error: moveError } = await supabase
        .from('user_cards')
        .update({ user_id: botId })
        .in('id', cardIds);
      
      if (moveError) throw moveError;

      const { data: currentPack } = await supabase
        .from('user_packs')
        .select('quantity')
        .eq('user_id', userId)
        .eq('pack_id', matchedPackKey)
        .single();

      const newAmount = (currentPack?.quantity || 0) + 1;

      const { error: packError } = await supabase
        .from('user_packs')
        .upsert(
            { 
              user_id: userId, 
              pack_id: matchedPackKey, 
              quantity: newAmount 
            },
            { onConflict: 'user_id, pack_id' }
        );

      if (packError) throw packError;

      // 7. ACTUALIZAR COOLDOWN
      uses += 1;
      let newExpiresAt = expiresAt;

      if (uses === 1 || expiresAt === 0) {
        newExpiresAt = now + COOLDOWN_TIME;
      }

      let userUpdates = {
        user_id: userId,
        licuadora_uses: uses,
        licuadora_reset_time: newExpiresAt
      };

      if (uses >= MAX_USES) {
          userUpdates.licuadora_notified = false;
      }

      await supabase.from('users').upsert(userUpdates, { onConflict: 'user_id' });

      // HISTORIAL
      await supabase.from('history_logs').insert({
          user_id: userId,
          action_type: 'licuadora',
          amount: 1,
          details: `Crafting: Creó 1x ${recipe.name}`
      });

      // Embed final
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle(`🌪️ ¡Licuadora Completada!`)
        .setDescription(`Has triturado **${cards.length} cartas** correctamente.`)
        .addFields(
          { name: 'Resultado', value: `Obtuviste 1x ${recipe.emoji} **${recipe.name}**` },
          { name: 'Inventario', value: 'El pack se ha guardado en tu inventario.' }
        )
        // Mención aquí también
        .setFooter({ text: `Usos restantes hoy: ${MAX_USES - uses} • ¿Dudas? Usa /recetas` });

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error("Error licuadora:", err);
      const msg = err.message || "Error desconocido";
      await interaction.editReply(`❌ Ocurrió un error: \`${msg}\``).catch(() => {});
    }
  }
};
