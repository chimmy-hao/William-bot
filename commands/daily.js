const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN ---
const COOLDOWN_TIME = 12 * 60 * 60 * 1000; // 12 Horas
const REWARD_AMOUNT = 2000;
const REWARD_RARITY = 2; 
const moneyEmoji = '<:berrycoin:1411737957081288724>';

// Función ID único
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('📅 Reclama tu recompensa diaria (Cada 12 horas)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    // ---------------------------------------------------------
    // 1. VERIFICACIÓN DE COOLDOWN (BASE DE DATOS)
    // ---------------------------------------------------------
    
    // Leemos si el usuario tiene una fecha guardada
    let { data: userCheck } = await supabase
        .from('users')
        .select('last_daily_claim')
        .eq('user_id', userId)
        .single();

    // Si no existe el usuario, asumimos 0 para que pueda reclamar y registrarse abajo
    const lastUsed = userCheck?.last_daily_claim || 0; 
    const remaining = COOLDOWN_TIME - (now - lastUsed);

    // Si falta tiempo, paramos aquí
    if (remaining > 0) {
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      return interaction.reply({
        content: `⏳ Ya ayudaste a William hoy. Vuelve en **${hours}h ${minutes}m**.`,
        ephemeral: true
      });
    }

    // ---------------------------------------------------------
    // 2. LÓGICA DE PREMIO (INTACTA)
    // ---------------------------------------------------------

    try {
      await interaction.deferReply();

      // Buscar carta rareza 2
      const { data: rareCards, error: cardError } = await supabase
        .from('base_cards')
        .select('*')
        .eq('rarity_level', REWARD_RARITY);

      if (cardError || !rareCards || rareCards.length === 0) {
        return interaction.editReply('❌ Error: No hay cartas de rareza 2 disponibles.');
      }

      const randomCard = rareCards[Math.floor(Math.random() * rareCards.length)];
      const uniqueCode = generateUniqueCardCode(randomCard.card_code);

      // Obtener datos del usuario para el Balance
      let { data: userData } = await supabase
        .from('users')
        .select('balance')
        .eq('user_id', userId)
        .single();

      if (!userData) {
        const { data: newUser } = await supabase
          .from('users')
          .insert({ user_id: userId, username: interaction.user.username, balance: 0 })
          .select()
          .single();
        userData = newUser;
      }

      const newBalance = (userData.balance || 0) + REWARD_AMOUNT;

      // ACTUALIZAR BALANCE Y EL TIEMPO (Aquí guardamos el cooldown)
      await supabase
        .from('users')
        .update({ 
            balance: newBalance,
            last_daily_claim: now // <--- ESTO GUARDA EL TIEMPO EN LA DB
        })
        .eq('user_id', userId);

      // Entregar carta
      await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: randomCard.id,
        rarity: randomCard.rarity_level,
        unique_card_id: uniqueCode
      });

      // Enviar GIF y Embed
      try {
        const file = new AttachmentBuilder('./daily.gif');
        
        const embed = new EmbedBuilder()
            .setColor('#e84393')
            .setTitle('📅 Recompensa Diaria')
            .setDescription(
            `Por ayudarlo a planear su cita con Est, William te otorga **${REWARD_AMOUNT}** ${moneyEmoji} y la carta \`${uniqueCode}\`.` +
            `\n\n🃏 **Carta recibida:** ${randomCard.name}`
            )
            .setImage('attachment://daily.gif')
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], files: [file] });
      } catch (e) {
        await interaction.editReply(`✅ **¡Daily reclamado!** (No pude cargar el GIF, pero recibiste tus premios).\nGanaste: ${randomCard.name} y ${REWARD_AMOUNT} monedas.`);
      }

    } catch (error) {
      console.error('Error en daily:', error);
      await interaction.editReply('❌ Hubo un error al reclamar tu recompensa.');
    }
  }
};
