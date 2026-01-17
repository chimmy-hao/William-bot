const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const moneyEmoji = '<:berrycoin:1411737957081288724>';

// --- CONFIGURACIÓN ---
const COOLDOWN_TIME = 12 * 60 * 60 * 1000; // 12 Horas
const REWARD_AMOUNT = 2000;
const REWARD_RARITY = 2; // ⚠️ ESTRICTO: Solo Rareza 2
const EVENT_CHANCE = 0.5; // 50% probabilidad de evento

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
    let { data: userCheck, error: userError } = await supabase
        .from('users')
        .select('last_daily_claim, daily_streak')
        .eq('user_id', userId)
        .single();
    
    // Si no existe el usuario, no pasa nada, se crea luego.
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

      if (diffTime < (oneDay * 2) && diffTime > 0) {
          currentStreak += 1;
      } else {
          currentStreak = 1;
      }

      // ---------------------------------------------------------
      // 2. BUSCAR PREMIO (LÓGICA BLINDADA)
      // ---------------------------------------------------------
      
      const isEventDrop = Math.random() < EVENT_CHANCE;
      let finalPool = [];
      
      // A. INTENTO: BUSCAR EVENTO (Solo si salió en el dado Y hay eventos activos)
      if (isEventDrop) {
          const { data: activeEvents } = await supabase
              .from('events_config')
              .select('event_name')
              .eq('is_active', true);

          const activeEventList = activeEvents ? activeEvents.map(e => e.event_name) : [];

          if (activeEventList.length > 0) {
              const { data: eventCards } = await supabase
                  .from('base_cards')
                  .select('*')
                  .in('event_type', activeEventList)
                  .eq('is_active', true); // Siempre verificar que la carta esté activa
              
              if (eventCards && eventCards.length > 0) {
                  finalPool = eventCards;
              }
          }
      }

      // B. FALLBACK: BUSCAR NORMAL RAREZA 2 (Si no salió evento o no había)
      if (finalPool.length === 0) {
          // Buscamos cartas Rareza 2 que NO sean de evento.
          // Usamos .or() para aceptar NULL o string vacío, por si acaso.
          const { data: normalRareCards, error: normalError } = await supabase
            .from('base_cards')
            .select('*')
            .eq('rarity_level', REWARD_RARITY) 
            .eq('is_active', true)
            .or('event_type.is.null,event_type.eq.""'); // <--- CORRECCIÓN CLAVE
          
          if (normalError) {
              console.error("Error Supabase Normal Cards:", normalError);
          }

          if (normalRareCards && normalRareCards.length > 0) {
              finalPool = normalRareCards;
          }
      }

      // SI AÚN ASÍ ESTÁ VACÍO...
      if (!finalPool || finalPool.length === 0) {
        console.log("⚠️ DEBUG: Falló la búsqueda. Verifica RLS en Supabase o que existan cartas con rarity_level=2 y event_type=null");
        return interaction.editReply('❌ **Error de Configuración:** No se encontraron cartas de **Rareza 2** disponibles.\n*Nota para el Admin: Revisa las Políticas RLS en Supabase.*');
      }

      // Elegir carta ganadora
      const randomCard = finalPool[Math.floor(Math.random() * finalPool.length)];
      const uniqueCode = generateUniqueCardCode(randomCard.card_code);

      const isEventCard = randomCard.event_type !== null && randomCard.event_type !== "";
      const cardLabel = isEventCard 
            ? `✨ **${randomCard.name}** (${randomCard.event_type.toUpperCase()})` 
            : `🃏 **${randomCard.name}**`;

      // 3. ACTUALIZAR USUARIO
      let { data: userData } = await supabase.from('users').select('balance').eq('user_id', userId).single();

      if (!userData) {
        const { data: newUser } = await supabase.from('users').insert({ user_id: userId, username: interaction.user.username, balance: 0 }).select().single();
        userData = newUser;
      }

      const newBalance = (userData.balance || 0) + REWARD_AMOUNT;

      // 4. GUARDAR
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
          details: `Reclamó daily. Carta: ${randomCard.name} [${isEventCard ? 'EVENT' : 'NORMAL'}]`
      });

      // 5. RESPUESTA
      const embed = new EmbedBuilder()
          .setColor(isEventCard ? '#E1306C' : '#e84393')
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
          await interaction.reply({ content: '❌ Error interno.', ephemeral: true });
      } else {
          await interaction.editReply('❌ Hubo un error al reclamar.');
      }
    }
  }
};
