const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Conexión a Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- CONFIGURACIÓN DE TIEMPOS ---
const TIMES = {
    WORK: 3 * 60 * 1000,           // 3 mins
    PHOTOCARD: 5 * 60 * 1000,      // 5 mins
    DAILY: 12 * 60 * 60 * 1000,    // 12 horas
    WEEKLY: 7 * 24 * 60 * 60 * 1000, // 7 días
    // --- NUEVOS ---
    GOLIVE: 3 * 60 * 1000,         // 3 mins (Live Stream)
    FREESTYLE: 15 * 60 * 1000,     // 15 mins
    WORLD_TOUR: 15 * 60 * 1000     // 15 mins
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cooldowns')
    .setDescription('⏳ Consulta el tiempo de espera de todos tus comandos.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    await interaction.deferReply();

    try {
      // 1. Obtener datos de USUARIOS (Tabla principal)
      let { data: user } = await supabase
        .from('users')
        .select('*') 
        .eq('user_id', userId)
        .single();

      if (!user) user = {};

      // 2. Obtener datos de WORLD TOUR (Tabla separada)
      // Usamos maybeSingle porque puede que el usuario no haya iniciado el tour aun
      const { data: tour } = await supabase
        .from('world_tours')
        .select('last_checkin')
        .eq('user_id', userId)
        .maybeSingle();

      // --- FUNCIÓN AUXILIAR PARA FORMATEAR ESTADO ---
      const getStatus = (lastClaimTime, duration) => {
        const last = lastClaimTime || 0;
        if (last === 0 || (now - last) >= duration) {
          return "✅ **¡Listo!**";
        }
        const readyAtUnixSeconds = Math.floor((last + duration) / 1000);
        return `⏳ <t:${readyAtUnixSeconds}:R>`;
      };

      // --- FUNCIÓN ESPECIAL PARA RESETEOS DIARIOS ---
      const getResetStatus = (resetTimeColumn, usesColumn, maxUses) => {
          const resetTime = user[resetTimeColumn] || 0;
          let uses = user[usesColumn] || 0;

          if (now > resetTime) uses = 0;

          if (uses < maxUses) {
              return `✅ **¡Listo!** (${maxUses - uses}/${maxUses})`;
          } else {
              const resetUnixSeconds = Math.floor(resetTime / 1000);
              return `⏳ Reset <t:${resetUnixSeconds}:R>`;
          }
      };

      // --- CONSTRUCCIÓN DEL EMBED ---
      const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle('⏱️ Tus Tiempos de Espera (Cooldowns)')
        .setDescription(`Hola <@${userId}>, este es el estado actual de tus comandos.`)
        .addFields(
          // GRUPO 1: Economía & Minijuegos
          {
            name: '💰 Economía & Minijuegos',
            value: [
              `💼 **Work:** ${getStatus(user.last_work_claim, TIMES.WORK)}`,
              `🔴 **Live Stream:** ${getStatus(user.last_golive_claim, TIMES.GOLIVE)}`,
              `🎤 **Freestyle:** ${getStatus(user.last_freestyle, TIMES.FREESTYLE)}`,
              `📅 **Daily:** ${getStatus(user.last_daily_claim, TIMES.DAILY)}`,
              `🗓️ **Weekly:** ${getStatus(user.last_weekly_claim, TIMES.WEEKLY)}`
            ].join('\n'),
            inline: false
          },
          // GRUPO 2: Coleccionismo & Eventos
          {
            name: '🃏 Gacha & Eventos',
            value: [
              `🎰 **Photocard:** ${getStatus(user.last_photocard_claim, TIMES.PHOTOCARD)}`,
              `🌍 **World Tour:** ${getStatus(tour?.last_checkin, TIMES.WORLD_TOUR)}`,
              `🐺 **Project Alpha:** ${getResetStatus('alpha_reset_time', 'alpha_uses', 3)}`,
              `🌪️ **Licuadora:** ${getResetStatus('licuadora_reset_time', 'licuadora_uses', 3)}`
            ].join('\n'),
            inline: false
          }
        )
        .setFooter({ text: 'Los tiempos se actualizan automáticamente.' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en cooldowns:', error);
      await interaction.editReply('❌ Ocurrió un error al consultar la base de datos.');
    }
  }
};
