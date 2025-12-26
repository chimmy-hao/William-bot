const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- CONFIGURACIÓN ---
const COOLDOWN_TIME = 7 * 24 * 60 * 60 * 1000; // 7 Días
const REWARDS = [
    { code: 'banana', count: 3, name: 'Banana Pack', emoji: '<:pack_banana:1413292531134759053>' },
    { code: 'grape',  count: 2, name: 'Grape Pack',  emoji: '<:pack_grape:1413292369675157655>' },
    { code: 'kiwi',   count: 1, name: 'Kiwi Pack',   emoji: '<:pack_kiwi:1413292487455408201>' }
];

// --- LISTA DE VARIACIÓN (Para dar frescura) ---
const weeklyGifs = [
    'https://media.tenor.com/sEWvs4aajowAAAAM/lykn-williamjkp.gif',
    'https://media.tenor.com/SkKGg1qaV7MAAAAM/lykn-williamjkp.gif',
    'https://media.tenor.com/_dCnuDEYc7MAAAAM/lykn-william-lykn.gif',
    'https://media.tenor.com/fbX5_SKWKO4AAAAM/lyknzip-lykn.gif'
    'https://media.tenor.com/Nx318i7PY0QAAAAM/lykn-william-lykn.gif'
    ];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weekly')
    .setDescription('📅 Reclama tu pack semanal (Cada 7 días)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    try {
      await interaction.deferReply();

      // 1. VERIFICAR COOLDOWN
      let { data: user } = await supabase.from('users').select('last_weekly_claim').eq('user_id', userId).single();
      
      const lastUsed = user?.last_weekly_claim || 0;
      const remaining = COOLDOWN_TIME - (now - lastUsed);

      if (remaining > 0) {
        const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
        const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        return interaction.editReply(`⏳ Ya ayudaste a William esta semana. Vuelve en **${days}d ${hours}h ${minutes}m**.`);
      }

      // 2. ENTREGA DE PREMIOS (PACKS)
      const rewardCodes = REWARDS.map(r => r.code);
      const { data: currentPacks } = await supabase
        .from('user_packs')
        .select('*')
        .eq('user_id', userId)
        .in('pack_code', rewardCodes);

      const updates = REWARDS.map(reward => {
        const existingPack = currentPacks?.find(p => p.pack_code === reward.code);
        return {
            user_id: userId,
            pack_code: reward.code,
            quantity: (existingPack ? existingPack.quantity : 0) + reward.count
        };
      });

      // Upsert Packs
      await supabase.from('user_packs').upsert(updates, { onConflict: 'user_id, pack_code' });

      // 3. ACTUALIZAR TIEMPO + NOTIFICACIÓN + HISTORIAL
      await supabase.from('users').upsert({
        user_id: userId,
        username: interaction.user.username,
        last_weekly_claim: now,
        weekly_notified: false // <--- 🔔 Recordatorio activado
      }, { onConflict: 'user_id' });

      // Historial
      await supabase.from('history_logs').insert({
          user_id: userId,
          action_type: 'weekly',
          details: `Reclamó pack semanal: Banana x3, Grape x2, Kiwi x1`
      });

      // 4. RESPUESTA VISUAL
      const packsList = REWARDS.map(r => 
        `**x${r.count}** ${r.name} ${r.emoji}`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('📅 Recompensa Semanal')
        .setDescription(
            `**William** te otorga estos packs por ayudarlo a organizar el ensayo para el *comeback* de **LYKN**. ¡Gracias por tu esfuerzo!\n\n` +
            `🎁 **Obtuviste:**\n${packsList}`
        )
        .setFooter({ text: '¡Vuelve en 7 días para más suministros!' })
        .setTimestamp();

      // --- LÓGICA DE IMAGEN (MAIN vs VARIACIÓN) ---
      const filesToSend = [];
      
      // Tiramos una moneda: 50% (0.5) de probabilidad de usar el GIF LOCAL (Main)
      // O si la lista está vacía, forzamos el local.
      const useMainGif = Math.random() < 0.5 || weeklyGifs.length === 0;

      if (useMainGif) {
          // CASO MAIN: Usamos el archivo local weekly.gif
          const file = new AttachmentBuilder('./weekly.gif');
          embed.setImage('attachment://weekly.gif');
          filesToSend.push(file);
      } else {
          // CASO VARIACIÓN: Usamos uno de la lista
          let randomGif = weeklyGifs[Math.floor(Math.random() * weeklyGifs.length)];
          
          // Arreglo Webp -> Gif
          if (randomGif.includes('.webp')) {
              randomGif = randomGif.replace('.webp', '.gif');
          }
          embed.setImage(randomGif);
      }

      await interaction.editReply({ embeds: [embed], files: filesToSend });

    } catch (error) {
      console.error('Error weekly:', error);
      if (!interaction.deferred && !interaction.replied) {
          await interaction.reply({ content: '❌ Error interno.', ephemeral: true });
      } else {
          await interaction.editReply('❌ Ocurrió un error al entregar tus recompensas.');
      }
    }
  }
};
