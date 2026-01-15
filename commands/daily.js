const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const moneyEmoji = '<:berrycoin:1411737957081288724>';

// --- CONFIGURACIÓN ---
const COOLDOWN_TIME = 12 * 60 * 60 * 1000; // 12 Horas
const REWARD_AMOUNT = 2000;
const REWARD_RARITY = 2; 

// --- LISTA DE GIFS (ENLACES CORREGIDOS) ---
// Usamos enlaces directos .gif para evitar que se congelen
const williamDailyGifs = [
    'https://media.tenor.com/ggNFlSnG8vwAAAAC/williamest-yeolykn.gif',
    'https://media.tenor.com/PM1ITcPfrbsAAAAC/lyknzip-williamest.gif',
    'https://media.tenor.com/FEFJhjlqVmgAAAAC/william-jkp-est-supha.gif',
    'https://media.tenor.com/QZLaSri-3vEAAAAC/williamest.gif',
    'https://media.tenor.com/v1Hx0S5x0E0AAAAC/lyknzip-williamest.gif',
    'https://media.tenor.com/QTdaowTO83YAAAAC/lyknzip-williamest.gif',
    'https://media.tenor.com/A47HPlAobh4AAAAC/williamest-willest.gif',
    'https://media.tenor.com/1d5MfbVU6GwAAAAC/williamest-william.gif',
    'https://media.tenor.com/y8_CKT4lbyIAAAAC/you-maniac-williamest.gif',
    'https://media.tenor.com/jKjMaqzJJ-UAAAAC/thamepo-thamepo-kiss.gif',
    'https://media.tenor.com/9801rZ2P1YYAAAAC/thamepo-thamepo-forehead-kiss.gif',
    'https://media.tenor.com/aOYEYRzEXdAAAAAC/thamepo-thamepo-heart-that-skips-a-beat.gif',
    'https://media.tenor.com/pOaLExWXPbQAAAAC/thamepo-thamepo-gmmtv.gif'
];

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

    // 1. COOLDOWN Y DATOS PREVIOS
    // Se agrega daily_streak a la selección para poder calcular
    let { data: userCheck } = await supabase
        .from('users')
        .select('last_daily_claim, daily_streak')
        .eq('user_id', userId)
        .single();

    const lastUsed = userCheck?.last_daily_claim || 0; 
    const remaining = COOLDOWN_TIME - (now - lastUsed);

    if (remaining > 0) {
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      return interaction.reply({
        content: `⏳ Ya ayudaste a William hoy. Vuelve en **${hours}h ${minutes}m**.`,
        ephemeral: true
      });
    }

    try {
      await interaction.deferReply();

      // --- LÓGICA DE RACHA (STREAK) ---
      const diffTime = now - lastUsed;
      const oneDay = 24 * 60 * 60 * 1000;
      let currentStreak = userCheck?.daily_streak || 0;

      // Si pasaron menos de 48 horas (2 días), se mantiene la racha
      if (diffTime < (oneDay * 2) && diffTime > 0) {
          currentStreak += 1;
      } else {
          // Si pasó más tiempo o es la primera vez, reinicia a 1
          currentStreak = 1;
      }

      // 2. BUSCAR PREMIO (SOLO ACTIVAS)
      const { data: rareCards, error: cardError } = await supabase
        .from('base_cards')
        .select('*')
        .eq('rarity_level', REWARD_RARITY)
        .eq('is_active', true); 

      if (cardError || !rareCards || rareCards.length === 0) {
        return interaction.editReply('❌ Error: No hay cartas de rareza 2 disponibles o activas.');
      }

      const randomCard = rareCards[Math.floor(Math.random() * rareCards.length)];
      const uniqueCode = generateUniqueCardCode(randomCard.card_code);

      // 3. OBTENER USUARIO
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

      // 4. ACTUALIZAR DB
      await supabase
        .from('users')
        .update({ 
            balance: newBalance,
            last_daily_claim: now,
            daily_notified: false,
            daily_streak: currentStreak // <--- ACTUALIZAMOS RACHA
        })
        .eq('user_id', userId);

      await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: randomCard.id,
        rarity: randomCard.rarity_level,
        unique_card_id: uniqueCode
      });

      await supabase.from('history_logs').insert({
          user_id: userId,
          action_type: 'daily',
          amount: REWARD_AMOUNT,
          details: `Reclamó daily. Carta extra: ${randomCard.name}`
      });

      // 5. RESPUESTA VISUAL
      const embed = new EmbedBuilder()
          .setColor('#e84393')
          .setTitle('📅 Recompensa Diaria')
          .setDescription(
            `Por ayudarlo a planear su cita con Est, William te otorga **${REWARD_AMOUNT}** ${moneyEmoji} y la carta \`${uniqueCode}\`.\n\n` +
            `🔥 **Racha Actual:** ${currentStreak} días\n\n` + // <--- MOSTRAMOS RACHA
            `🃏 **Carta recibida:** ${randomCard.name}`
          )
          .setTimestamp();

      // Ya no necesitamos el "parche" de webp porque actualizamos la lista arriba
      // Pero dejamos una lógica simple por seguridad
      if (williamDailyGifs && williamDailyGifs.length > 0) {
          const randomGif = williamDailyGifs[Math.floor(Math.random() * williamDailyGifs.length)];
          embed.setImage(randomGif);
      } 

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en daily:', error);
      if (!interaction.deferred && !interaction.replied) {
          await interaction.reply({ content: '❌ Error interno al reclamar.', ephemeral: true });
      } else {
          await interaction.editReply('❌ Hubo un error al reclamar tu recompensa.');
      }
    }
  }
};
