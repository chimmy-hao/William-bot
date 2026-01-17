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
const EVENT_CHANCE = 0.5; // 50% de probabilidad de evento

// --- LISTA DE GIFS ---
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

      if (diffTime < (oneDay * 2) && diffTime > 0) {
          currentStreak += 1;
      } else {
          currentStreak = 1;
      }

      // ---------------------------------------------------------
      // 2. BUSCAR PREMIO (SISTEMA HÍBRIDO CON VALIDACIÓN DE ACTIVIDAD)
      // ---------------------------------------------------------
      
      // Decidimos si intentamos buscar Evento o Normal (50/50)
      const isEventDrop = Math.random() < EVENT_CHANCE;
      let finalPool = [];
      let searchingEvent = false;

      if (isEventDrop) {
          // A. Verificar qué eventos están ACTIVOS en la tabla de configuración
          const { data: activeEvents } = await supabase
              .from('events_config')
              .select('event_name')
              .eq('is_active', true);

          // Lista de nombres de eventos activos (ej: ['insta', 'halloween'])
          const activeEventList = activeEvents ? activeEvents.map(e => e.event_name) : [];

          // Si hay al menos un evento activo, buscamos cartas de esos eventos
          if (activeEventList.length > 0) {
              searchingEvent = true;
              const { data: eventCards } = await supabase
                  .from('base_cards')
                  .select('*')
                  .in('event_type', activeEventList) // Solo tipos que estén activos
                  .eq('is_active', true);
              
              if (eventCards && eventCards.length > 0) {
                  finalPool = eventCards;
              }
          }
      }

      // --- FALLBACK ---
      // Si no era drop de evento, O si era evento pero no había ninguno activo,
      // O si había activo pero no tenía cartas -> Buscamos cartas NORMALES
      if (finalPool.length === 0) {
          // Buscamos cartas normales (Rareza 2, sin evento)
          const { data: normalCards } = await supabase
            .from('base_cards')
            .select('*')
            .eq('rarity_level', REWARD_RARITY)
            .is('event_type', null)
            .eq('is_active', true);
          
          finalPool = normalCards;
      }

      if (!finalPool || finalPool.length === 0) {
        return interaction.editReply('❌ Error crítico: No hay cartas configuradas en el sistema.');
      }

      // Elegir carta ganadora
      const randomCard = finalPool[Math.floor(Math.random() * finalPool.length)];
      const uniqueCode = generateUniqueCardCode(randomCard.card_code);

      // Detectar si la carta ganada es de evento (para el mensaje)
      const isEventCard = randomCard.event_type !== null;
      const cardLabel = isEventCard 
            ? `✨ **${randomCard.name}** (${randomCard.event_type.toUpperCase()})` 
            : `🃏 **${randomCard.name}**`;

      // 3. OBTENER/CREAR USUARIO
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
            daily_streak: currentStreak 
        })
        .eq('user_id', userId);

      await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: randomCard.id,
        rarity: randomCard.rarity_level, // Generalmente 2 para estos casos
        unique_card_id: uniqueCode
      });

      await supabase.from('history_logs').insert({
          user_id: userId,
          action_type: 'daily',
          amount: REWARD_AMOUNT,
          details: `Reclamó daily. Carta: ${randomCard.name} [${isEventCard ? 'EVENT' : 'NORMAL'}]`
      });

      // 5. RESPUESTA VISUAL
      const embed = new EmbedBuilder()
          .setColor(isEventCard ? '#E1306C' : '#e84393') // Color especial si es evento
          .setTitle(isEventCard ? '📸 Recompensa Diaria: ¡Evento!' : '📅 Recompensa Diaria')
          .setDescription(
            `Por ayudarlo a planear su cita con Est, William te otorga **${REWARD_AMOUNT}** ${moneyEmoji} y la carta \`${uniqueCode}\`.\n\n` +
            `🔥 **Racha Actual:** ${currentStreak} días\n\n` + 
            `🎁 **Carta recibida:** ${cardLabel}`
          )
          .setTimestamp();

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
