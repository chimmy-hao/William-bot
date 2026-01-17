const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const moneyEmoji = '<:berrycoin:1411737957081288724>';

// --- CONFIGURACIÓN ---
const COOLDOWN_TIME = 12 * 60 * 60 * 1000; 
const REWARD_AMOUNT = 2000;
const REWARD_RARITY = 2; // Solo Rareza 2
const EVENT_CHANCE = 0.5; // 50% chance

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

    // 1. CHEQUEO DE COOLDOWN
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

      // RACHA
      const diffTime = now - lastUsed;
      const oneDay = 24 * 60 * 60 * 1000;
      let currentStreak = userCheck?.daily_streak || 0;
      if (diffTime < (oneDay * 2) && diffTime > 0) currentStreak += 1;
      else currentStreak = 1;

      // ---------------------------------------------------------
      // 2. BUSCAR CARTAS (ESTRATEGIA SEGURA: BAJAR TODO)
      // ---------------------------------------------------------
      
      // PASO A: Traemos TODAS las cartas de Rareza 2 activas.
      // (Esta es la misma consulta que usa /test_db y sabemos que funciona)
      const { data: allRareCards, error: dbError } = await supabase
          .from('base_cards')
          .select('*')
          .eq('rarity_level', REWARD_RARITY) // Rareza 2
          .eq('is_active', true);

      if (dbError) {
          console.error("Daily Error DB:", dbError);
          return interaction.editReply(`❌ **Error de Base de Datos:** ${dbError.message}`);
      }

      if (!allRareCards || allRareCards.length === 0) {
          return interaction.editReply('❌ **Error Crítico:** El sistema devolvió 0 cartas de Rareza 2 (¿Está vacía la tabla?).');
      }

      // PASO B: Filtramos en JAVASCRIPT (Más seguro que SQL ahora mismo)
      // Separamos las cartas en dos grupos: Evento y Normales
      const eventCards = [];
      const normalCards = [];

      // Revisamos eventos activos en DB
      const { data: activeConfigs } = await supabase
          .from('events_config')
          .select('event_name')
          .eq('is_active', true);
      
      const activeEventNames = activeConfigs ? activeConfigs.map(e => e.event_name) : [];

      // Clasificamos las cartas que bajamos
      allRareCards.forEach(card => {
          if (card.event_type && card.event_type.trim() !== "") {
              // Es de evento. ¿Está activo el evento?
              if (activeEventNames.includes(card.event_type)) {
                  eventCards.push(card);
              }
          } else {
              // Es normal (event_type es null o vacío)
              normalCards.push(card);
          }
      });

      // PASO C: Tiramos el dado
      const isEventDrop = Math.random() < EVENT_CHANCE;
      let finalPool = [];

      if (isEventDrop && eventCards.length > 0) {
          finalPool = eventCards; // Ganó evento y hay cartas
      } else {
          finalPool = normalCards; // Ganó normal (o falló evento)
      }

      // FALLBACK FINAL: Si el pool está vacío (ej: salió normal pero no hay normales)
      if (finalPool.length === 0) {
          // Si no hay de lo que buscábamos, usamos CUALQUIERA de rareza 2 que tengamos
          // (Esto evita el error critico si tienes 30 cartas pero el filtro falló)
          finalPool = allRareCards; 
      }

      // Elegir carta ganadora
      const randomCard = finalPool[Math.floor(Math.random() * finalPool.length)];
      const uniqueCode = generateUniqueCardCode(randomCard.card_code);
      const isEventCard = randomCard.event_type && randomCard.event_type.trim() !== "";
      
      const cardLabel = isEventCard 
            ? `✨ **${randomCard.name}** (${randomCard.event_type.toUpperCase()})` 
            : `🃏 **${randomCard.name}**`;

      // 3. LOGICA DE USUARIO Y ENTREGA (Igual que siempre)
      let { data: userData } = await supabase.from('users').select('balance').eq('user_id', userId).single();
      if (!userData) {
        const { data: newUser } = await supabase.from('users').insert({ user_id: userId, username: interaction.user.username, balance: 0 }).select().single();
        userData = newUser;
      }

      const newBalance = (userData.balance || 0) + REWARD_AMOUNT;

      await supabase.from('users').update({ 
            balance: newBalance,
            last_daily_claim: now,
            daily_notified: false,
            daily_streak: currentStreak 
        }).eq('user_id', userId);

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
          details: `Reclamó daily. Carta: ${randomCard.name}`
      });

      // EMBED RESPUESTA
      const embed = new EmbedBuilder()
          .setColor(isEventCard ? '#E1306C' : '#e84393')
          .setTitle(isEventCard ? '📸 Recompensa Diaria: ¡Evento!' : '📅 Recompensa Diaria')
          .setDescription(
            `Por ayudarlo a planear su cita con Est, William te otorga **${REWARD_AMOUNT}** ${moneyEmoji} y la carta \`${uniqueCode}\`.\n\n` +
            `🔥 **Racha Actual:** ${currentStreak} días\n\n` + 
            `🎁 **Carta recibida:** ${cardLabel}`
          )
          .setTimestamp();

      if (williamDailyGifs.length > 0) {
          const randomGif = williamDailyGifs[Math.floor(Math.random() * williamDailyGifs.length)];
          embed.setImage(randomGif);
      } 

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error daily:', error);
      if(!interaction.replied) await interaction.editReply('❌ Error interno: ' + error.message);
    }
  }
};
