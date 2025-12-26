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

// --- LISTA DE GIFS ---
const williamDailyGifs = [
    'https://media.tenor.com/ggNFlSnG8vwAAAA1/williamest-yeolykn-williamest-tiktok.webp',
    'https://media.tenor.com/PM1ITcPfrbsAAAAM/lyknzip-williamest.gif',
    'https://media.tenor.com/FEFJhjlqVmgAAAAM/william-jkp-est-supha.gif',
    'https://media.tenor.com/pOaLExWXPbQAAAA1/thamepo-thamepo-gmmtv.gif',
    'https://media.tenor.com/QZLaSri-3vEAAAAM/williamest.gif',
    'https://media.tenor.com/v1Hx0S5x0E0AAAAM/lyknzip-williamest.gif',
    'https://media.tenor.com/QTdaowTO83YAAAAM/lyknzip-williamest.gif',
    'https://media.tenor.com/A47HPlAobh4AAAA1/williamest-willest.gif',
    'https://media.tenor.com/1d5MfbVU6GwAAAA1/williamest-william.gif',
    'https://media.tenor.com/y8_CKT4lbyIAAAAM/you-maniac-williamest.gif',
    'https://media.tenor.com/jKjMaqzJJ-UAAAAM/thamepo-thamepo-kiss.gif',
    'https://media.tenor.com/9801rZ2P1YYAAAAM/thamepo-thamepo-forehead-kiss.gif',
    'https://media.tenor.com/aOYEYRzEXdAAAAAM/thamepo-thamepo-heart-that-skips-a-beat.gif'
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

    // 1. COOLDOWN
    let { data: userCheck } = await supabase
        .from('users')
        .select('last_daily_claim')
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

      // 2. BUSCAR PREMIO (SOLO ACTIVAS)
      const { data: rareCards, error: cardError } = await supabase
        .from('base_cards')
        .select('*')
        .eq('rarity_level', REWARD_RARITY)
        .eq('is_active', true); // <--- ÚNICO CAMBIO: Filtro para ignorar cartas del pool

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
            daily_notified: false
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
            `Por ayudarlo a planear su cita con Est, William te otorga **${REWARD_AMOUNT}** ${moneyEmoji} y la carta \`${uniqueCode}\`.` +
            `\n\n🃏 **Carta recibida:** ${randomCard.name}`
          )
          .setTimestamp();

      const filesToSend = [];

      if (williamDailyGifs && williamDailyGifs.length > 0) {
          let randomGif = williamDailyGifs[Math.floor(Math.random() * williamDailyGifs.length)];
          
          // 🔧 PARCHE: Webp a Gif
          if (randomGif.includes('.webp')) {
              randomGif = randomGif.replace('.webp', '.gif');
          }
          
          embed.setImage(randomGif);
      } else {
          const file = new AttachmentBuilder('./daily.gif');
          embed.setImage('attachment://daily.gif');
          filesToSend.push(file);
      }

      await interaction.editReply({ embeds: [embed], files: filesToSend });

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
