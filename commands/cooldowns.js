const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Conexión a Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- CONFIGURACIÓN DE TIEMPOS ---
// Deben coincidir exactamente con los que usas en los otros archivos
const TIMES = {
    WORK: 3 * 60 * 1000,           // 3 mins
    PHOTOCARD: 5 * 60 * 1000,      // 5 mins
    DAILY: 12 * 60 * 60 * 1000,    // 12 horas
    WEEKLY: 7 * 24 * 60 * 60 * 1000 // 7 días
    // Alpha y Licuadora no necesitan tiempo fijo aquí porque leemos su "reset_time" directo de la DB
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
      // 1. Obtener todos los datos del usuario de una sola vez
      let { data: user } = await supabase
        .from('users')
        .select('*') // Seleccionamos todas las columnas
        .eq('user_id', userId)
        .single();

      // Si el usuario es nuevo y no tiene registro, usamos un objeto vacío (todo estará "Listo")
      if (!user) user = {};

      // --- FUNCIÓN AUXILIAR PARA FORMATEAR ESTADO ---
      // Calcula si está listo o devuelve el timestamp relativo de Discord
      const getStatus = (lastClaimTime, duration) => {
        const last = lastClaimTime || 0;
        // Si es 0 (nunca usado) o ya pasó el tiempo:
        if (last === 0 || (now - last) >= duration) {
          return "✅ **¡Listo!**";
        }
        // Si falta tiempo: Calculamos cuándo estará listo en el futuro
        const readyAtUnixSeconds = Math.floor((last + duration) / 1000);
        // Usamos el formato mágico de Discord <t:X:R> para cuenta regresiva dinámica
        return `⏳ <t:${readyAtUnixSeconds}:R>`;
      };

      // --- FUNCIÓN ESPECIAL PARA ALPHA/LICUADORA (Usos Diarios) ---
      // Estos funcionan distinto: tienen una hora de reseteo fija
      const getResetStatus = (resetTimeColumn, usesColumn, maxUses) => {
          const resetTime = user[resetTimeColumn] || 0;
          let uses = user[usesColumn] || 0;

          // Si ya pasó la hora de reset, los usos son 0 virtualmente
          if (now > resetTime) uses = 0;

          if (uses < maxUses) {
              // Aún le quedan usos disponibles ahora mismo
              return `✅ **¡Listo!** (${maxUses - uses}/${maxUses} disponibles)`;
          } else {
              // Gastó todos los usos, mostrar tiempo para el reset
              const resetUnixSeconds = Math.floor(resetTime / 1000);
              return `⏳ Reset <t:${resetUnixSeconds}:R>`;
          }
      };


      // --- CONSTRUCCIÓN DEL EMBED ---
      const embed = new EmbedBuilder()
        .setColor('#2b2d31') // Un color oscuro estilo Discord
        .setTitle('⏱️ Tus Tiempos de Espera (Cooldowns)')
        .setDescription(`Hola <@${userId}>, este es el estado actual de tus comandos.`)
        .addFields(
          // GRUPO 1: Economía Básica
          {
            name: '💰 Economía & Suministros',
            value: [
              `💼 **Work:** ${getStatus(user.last_work_claim, TIMES.WORK)}`,
              `📅 **Daily:** ${getStatus(user.last_daily_claim, TIMES.DAILY)}`,
              `🗓️ **Weekly:** ${getStatus(user.last_weekly_claim, TIMES.WEEKLY)}`
            ].join('\n'),
            inline: false
          },
          // GRUPO 2: Coleccionismo & Juegos
          {
            name: '🃏 Gacha & Juegos',
            value: [
              `🎰 **Photocard:** ${getStatus(user.last_photocard_claim, TIMES.PHOTOCARD)}`,
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
