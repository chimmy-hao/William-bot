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

// --- LISTA DE VARIACIÓN ---
const weeklyGifs = [
    'https://media.tenor.com/sEWvs4aajowAAAAM/lykn-williamjkp.gif',
    'https://media.tenor.com/SkKGg1qaV7MAAAAM/lykn-williamjkp.gif',
    'https://media.tenor.com/_dCnuDEYc7MAAAAM/lykn-william-lykn.gif',
    'https://media.tenor.com/fbX5_SKWKO4AAAAM/lyknzip-lykn.gif', // <--- FALTABA ESTA COMA AQUÍ
    'https://media.tenor.com/Nx318i7PY0QAAAAM/lykn-william-lykn.gif'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weekly')
    .setDescription('📅 Reclama tu pack semanal (Cada 7 días)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    // Usamos new Date() para manejar mejor timestamps en DB
    const now = Date.now(); 

    try {
      await interaction.deferReply();

      // 1. VERIFICAR COOLDOWN
      let { data: user } = await supabase.from('users').select('last_weekly_claim').eq('user_id', userId).single();
      
      // Convertimos a número por seguridad si viene de DB como string ISO
      const lastUsed = user?.last_weekly_claim ? new Date(user.last_weekly_claim).getTime() : 0;
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
      const { error: packError } = await supabase.from('user_packs').upsert(updates, { onConflict: 'user_id, pack_code' });
      if (packError) throw new Error(`Error guardando packs: ${packError.message}`);

      // 3. ACTUALIZAR TIEMPO + NOTIFICACIÓN
      // Guardamos la fecha en formato ISO para compatibilidad con Supabase
      await supabase.from('users').upsert({
        user_id: userId,
        username: interaction.user.username,
        last_weekly_claim: new Date().toISOString(), // Formato seguro
        weekly_notified: false 
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
      
      // Tiramos una moneda: 50% probabilidad de usar el GIF LOCAL (Main)
      // Si la lista de gifs está vacía, usamos el local obligatoriamente
      const useMainGif = Math.random() < 0.5 || weeklyGifs.length === 0;

      // Variable para guardar la URL final si es remota
      let finalImageUrl = null;

      if (useMainGif) {
          try {
             // CASO MAIN: Intentamos usar el archivo local
             const file = new AttachmentBuilder('./weekly.gif');
             embed.setImage('attachment://weekly.gif');
             filesToSend.push(file);
          } catch (e) {
             console.error("No se encontró weekly.gif local, usando remoto.");
             // Fallback si no existe el archivo local
             finalImageUrl = weeklyGifs[0];
          }
      } 
      
      if (!useMainGif || finalImageUrl) {
          // CASO VARIACIÓN (o fallback): Usamos uno de la lista
          let randomGif = finalImageUrl || weeklyGifs[Math.floor(Math.random() * weeklyGifs.length)];
          
          // Arreglo Webp -> Gif (Discord a veces prefiere gif explícito en embeds)
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
          await interaction.editReply(`❌ Ocurrió un error: ${error.message}`);
      }
    }
  }
};
