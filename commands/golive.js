const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- CONFIGURACIÓN ---
const COOLDOWN_MINUTES = 3; 
const COOLDOWN_TIME = COOLDOWN_MINUTES * 60 * 1000; 

// Emojis
const strawberryEmoji = '<:berrycoin:1411737957081288724>'; // Tu emoji de moneda
const liveEmoji = '🔴';
const eyeEmoji = '👁️';

// GIFs de Live (Usa los limpios que te pasé o agrega nuevos)
const LIVE_GIFS = [
    'https://media.tenor.com/2LpVedAVi88AAAAM/williamjkp-lykn-william.gif',
    'https://media.tenor.com/dAGPE3yPe_IAAAAM/williamjkp-lykn.gif',
    'https://media.tenor.com/Uk-Y4jTKraYAAAAM/lykn-lyknzip.gif'
];

// Comentarios simulados de fans
const FAN_COMMENTS = [
    '¡Qué guapo estás hoy! 😍',
    'NOTICE ME PLS 🔥',
    'Te amamos William ❤️',
    '¡Canta un poco por favor! 🎤',
    'Saluda a Argentina 🇦🇷',
    'Oppa saranghae 🫰',
    '¡Ese outfit te queda increíble! ✨'
];

// Función para esperar (sleep)
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('golive')
    .setDescription('🔴 Inicia un Live Stream sorpresa para ganar Berrycoins.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    try {
      // 1. CHEQUEO DE COOLDOWN
      let { data: user } = await supabase.from('users').select('*').eq('user_id', userId).single();
      
      if (!user) {
          // Crear usuario si no existe
          const { data: newUser } = await supabase.from('users').insert({ user_id: userId, username: interaction.user.username }).select().single();
          user = newUser;
      }

      const lastUsed = user.last_golive_claim || 0;
      const remaining = COOLDOWN_TIME - (now - lastUsed);

      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        return interaction.reply({ 
            content: `⏳ **¡El manager no te deja!** Debes esperar **${minutes}m ${seconds}s** para hacer otro Live.`, 
            ephemeral: true 
        });
      }

      // IMPORTANTE: DeferReply permite editar el mensaje varias veces para la animación
      await interaction.deferReply();

      // Variables de la simulación
      let viewers = 300 + Math.floor(Math.random() * 200); // Empieza con ~300
      let earnings = 0;
      const gif = LIVE_GIFS[Math.floor(Math.random() * LIVE_GIFS.length)];

      // --- FASE 1: INICIO (0s) ---
      const embed = new EmbedBuilder()
        .setColor('#FF0000') // Rojo LIVE
        .setTitle(`${liveEmoji} INSTAGRAM LIVE | ${eyeEmoji} ${viewers} viewers`)
        .setDescription(
            `**@william.jkp** ha iniciado un video en vivo.\n\n` +
            `👋 "¡Hola a todos! Tenía un rato libre antes del ensayo..."\n\n` +
            `💰 **Ganancia:** ${earnings} ${strawberryEmoji}`
        )
        .setImage(gif)
        .setFooter({ text: '🔴 Transmitiendo...' });

      await interaction.editReply({ embeds: [embed] });
      await wait(4000); // Espera 4 segundos

      // --- FASE 2: INTERACCIÓN (4s) ---
      viewers += Math.floor(Math.random() * 1000) + 500; // Suben viewers
      const gift1 = Math.floor(Math.random() * 100) + 50; // Regalo pequeño
      earnings += gift1;
      const comment1 = FAN_COMMENTS[Math.floor(Math.random() * FAN_COMMENTS.length)];

      embed.setDescription(
        `**@william.jkp** está saludando a la cámara.\n\n` +
        `💬 *fan_123:* ${comment1}\n` +
        `🎁 *fan_love* envió una **Rosa** (+${gift1} ${strawberryEmoji})\n\n` +
        `💰 **Ganancia:** ${earnings} ${strawberryEmoji}`
      );
      embed.setTitle(`${liveEmoji} INSTAGRAM LIVE | ${eyeEmoji} ${viewers.toLocaleString()} viewers`);
      
      await interaction.editReply({ embeds: [embed] });
      await wait(4000); 

      // --- FASE 3: CLÍMAX (8s) ---
      viewers += Math.floor(Math.random() * 2000) + 1000; // Muchos viewers
      const gift2 = Math.floor(Math.random() * 300) + 150; // Regalo grande
      earnings += gift2;
      const comment2 = FAN_COMMENTS[Math.floor(Math.random() * FAN_COMMENTS.length)];

      embed.setDescription(
        `**@william.jkp** hace un guiño y un corazón con los dedos 😉🫶\n\n` +
        `💬 *fan_army:* AHHH QUÉ LINDO 🔥\n` +
        `💬 *stan_acc:* ${comment2}\n` +
        `🎁 *rich_fan* envió un **Cohete** (+${gift2} ${strawberryEmoji})\n\n` +
        `💰 **Ganancia:** ${earnings} ${strawberryEmoji}`
      );
      embed.setTitle(`${liveEmoji} INSTAGRAM LIVE | ${eyeEmoji} ${viewers.toLocaleString()} viewers`);

      await interaction.editReply({ embeds: [embed] });
      await wait(4000);

      // --- FASE FINAL: CIERRE Y GUARDADO (12s) ---
      // Guardar en DB
      const totalBalance = (user.balance || 0) + earnings;
      
      await supabase.from('users').update({ 
          balance: totalBalance,
          last_golive_claim: Date.now(),
          golive_notified: false // <--- Activa el Reminder para dentro de 3 min
      }).eq('user_id', userId);

      // Log (Opcional)
      // await supabase.from('history_logs').insert({...}) 

      embed.setColor('#2b2d31') // Color gris (apagado)
      embed.setTitle(`⚫ LIVE FINALIZADO | Resumen`)
      embed.setDescription(
          `👋 "¡Me tengo que ir, el manager me llama! Bye bye~"\n\n` +
          `📊 **Estadísticas del Stream:**\n` +
          `👁️ **Pico de viewers:** ${viewers.toLocaleString()}\n` +
          `🍓 **Total recaudado:** **${earnings}** ${strawberryEmoji}\n\n` +
          `⏰ *Podrás hacer otro live en 3 minutos.*`
      );
      embed.setFooter({ text: 'Live finalizado' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en golive:', error);
      // Si falla a mitad, intentamos avisar
      try {
        await interaction.editReply({ content: '❌ Se cortó la conexión del Live (Error interno).' });
      } catch (e) {}
    }
  },
};
