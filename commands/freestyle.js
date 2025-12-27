const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- CONFIGURACIÓN ---
const COOLDOWN_MINUTES = 15;
const COOLDOWN_TIME = COOLDOWN_MINUTES * 60 * 1000; 
const TIME_TO_WRITE = 15000; // 15 segundos para escribir

// Emojis
const micEmoji = '🎤';
const moneyEmoji = '<:berrycoin:1411737957081288724>'; 
const clockEmoji = '⏱️';

// Temáticas aleatorias para inspirar
const TOPICS = [
    'Vida en la calle', 'Tu comida favorita', 'El amor de tu vida', 
    'Discord', 'Programación', 'Un día lluvioso', 'Tus sueños', 
    'Videojuegos', 'El futuro', 'Dinero y fama', 'Amigos falsos', 'Fiesta de fin de año'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('freestyle')
    .setDescription('🎤 ¡Tira tus mejores barras en 15 segundos y gana premios!'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    try {
      // Usamos deferReply porque vamos a consultar la DB
      await interaction.deferReply();

      // 1. Obtener usuario y chequear cooldown
      // Asumimos que existen las columnas 'last_freestyle' y 'freestyle_notified' en 'users'
      let { data: user, error } = await supabase.from('users').select('*').eq('user_id', userId).single();

      if (error || !user) {
          // Si no existe, lo creamos
          await supabase.from('users').insert({ user_id: userId, username: interaction.user.username });
          // Recuperamos el usuario recién creado para asegurar datos
          const { data: newUser } = await supabase.from('users').select('*').eq('user_id', userId).single();
          user = newUser;
      }

      // 2. Verificación de Cooldown
      const lastPlayed = user.last_freestyle || 0;
      const remaining = COOLDOWN_TIME - (now - lastPlayed);

      if (remaining > 0) {
          const minutes = Math.floor(remaining / 60000);
          const seconds = Math.floor((remaining % 60000) / 1000);
          return interaction.editReply(`⏳ **¡Epa! Descansa la voz.**\nPuedes volver a tirar freestyle en **${minutes}m ${seconds}s**.`);
      }

      // 3. Preparar el juego
      const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
      
      const startEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle(`${micEmoji} FREESTYLE SESSION`)
          .setDescription(
              `¡Tienes **15 SEGUNDOS** para escribir una rima!\n\n` +
              `🗣️ **Temática:** \`${topic}\`\n\n` +
              `👇 **¡ESCRIBE AHORA EN EL CHAT!** 👇`
          )
          .setFooter({ text: 'El tiempo corre...' });

      await interaction.editReply({ embeds: [startEmbed] });

      // 4. Crear colector de mensajes (filtro: mismo usuario, mismo canal)
      const filter = m => m.author.id === userId;
      const collector = interaction.channel.createMessageCollector({ filter, time: TIME_TO_WRITE, max: 1 });

      collector.on('collect', async (m) => {
          // --- ÉXITO: El usuario escribió algo ---
          
          // Recompensa random (ej. 50 a 150 monedas)
          const pay = Math.floor(Math.random() * 101) + 50; 
          
          // Calcular bonus si escribió mucho (opcional, por diversión)
          const bonus = m.content.length > 50 ? 20 : 0;
          const totalPay = pay + bonus;

          // ACTUALIZACIÓN DB (Pago + Cooldown + Reminder Reset)
          await supabase.from('users').update({ 
              balance: (user.balance || 0) + totalPay,
              last_freestyle: Date.now(),
              freestyle_notified: false 
          }).eq('user_id', userId);

          // --- LOG HISTORIAL ---
          await supabase.from('history_logs').insert({
              user_id: userId,
              action_type: 'freestyle',
              amount: totalPay,
              details: `Freestyle Session completada`
          });
          // ---------------------

          const successEmbed = new EmbedBuilder()
              .setColor('#FFD700')
              .setTitle('🔥 ¡BARRA PESADA!')
              .setDescription(
                  `> *"${m.content}"*\n\n` +
                  `¡El público enloquece! 🏟️\n` +
                  `💰 **Ganaste:** ${totalPay} ${moneyEmoji}\n` +
                  `⏰ **Cooldown:** 15 minutos.`
              );

          await m.reply({ embeds: [successEmbed] });
      });

      collector.on('end', async (collected) => {
          // --- TIEMPO AGOTADO: El usuario no escribió nada ---
          if (collected.size === 0) {
              
              // Igual actualizamos el cooldown para que no spamee el comando
              // También reseteamos el reminder para avisarle en 15 min que intente de nuevo
              await supabase.from('users').update({ 
                  last_freestyle: Date.now(),
                  freestyle_notified: false 
              }).eq('user_id', userId);

              const failEmbed = new EmbedBuilder()
                  .setColor('#FF0000')
                  .setTitle('🔇 SE TE FUE EL TIEMPO')
                  .setDescription('¡Te quedaste mudo frente al micrófono! 😰\nInténtalo de nuevo en 15 minutos.');
              
              // Usamos followUp porque el editReply original ya fue usado para la cuenta regresiva
              await interaction.followUp({ embeds: [failEmbed], ephemeral: true });
          }
      });

    } catch (err) {
      console.error('Error en freestyle:', err);
      // Si falló antes de enviar nada, intentamos avisar
      try {
        await interaction.editReply('❌ Hubo un error técnico con el micrófono. Intenta de nuevo.');
      } catch (e) {}
    }
  }
};
