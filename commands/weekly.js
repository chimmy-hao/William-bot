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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weekly')
    .setDescription('📅 Reclama tu pack semanal (Cada 7 días)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    try {
      await interaction.deferReply();

      // 1. VERIFICAR COOLDOWN EN DB
      let { data: user } = await supabase.from('users').select('last_weekly_claim').eq('user_id', userId).single();
      
      // Si el usuario no existe, asumimos que puede reclamar (se creará luego)
      const lastUsed = user?.last_weekly_claim || 0;
      const remaining = COOLDOWN_TIME - (now - lastUsed);

      if (remaining > 0) {
        const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
        const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        return interaction.editReply(`⏳ Ya ayudaste a William esta semana. Vuelve en **${days}d ${hours}h ${minutes}m**.`);
      }

      // 2. LOGICA DE PREMIOS (PACKS)
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

      // Guardar Packs
      await supabase.from('user_packs').upsert(updates, { onConflict: 'user_id, pack_code' });

      // 3. ACTUALIZAR TIEMPO EN DB
      await supabase.from('users').upsert({
        user_id: userId,
        username: interaction.user.username,
        last_weekly_claim: now
      }, { onConflict: 'user_id' });

      // 4. RESPUESTA ESTÉTICA
      // Generamos la lista bonita
      const packsList = REWARDS.map(r => 
        `**x${r.count}** ${r.name} ${r.emoji}`
      ).join('\n');

      // Preparamos el GIF
      const file = new AttachmentBuilder('./weekly.gif');

      const embed = new EmbedBuilder()
        .setColor('#FFD700') // Dorado
        .setTitle('📅 Recompensa Semanal')
        .setDescription(
            `**William** te otorga estos packs por ayudarlo a organizar el ensayo para el *comeback* de **LYKN**. ¡Gracias por tu esfuerzo!\n\n` +
            `🎁 **Obtuviste:**\n${packsList}`
        )
        .setImage('attachment://weekly.gif')
        .setFooter({ text: '¡Vuelve en 7 días para más suministros!' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [file] });

    } catch (error) {
      console.error('Error weekly:', error);
      await interaction.editReply('❌ Ocurrió un error al entregar tus recompensas.');
    }
  }
};
