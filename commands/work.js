const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const moneyEmoji = '<:berrycoin:1411737957081288724>';

// --- LISTA DE GIFS ---
const williamGifs = [
    'https://media.tenor.com/oDi9vuSDFn8AAAAM/williamjkp-williamest.gif',
    'https://media.tenor.com/2LpVedAVi88AAAAM/williamjkp-lykn-william.gif',
    'https://media.tenor.com/O0BIiNbkxeMAAAAM/williamjkp-william-jkp.gif',
    'https://media.tenor.com/hLNjARrdJWwAAAAM/sassy-william-williamjkp-aneexwe.gif',
    'https://media.tenor.com/rkYYqR1JaX8AAAAM/williamjkp-tuilover.gif',
    'https://media.tenor.com/D4hYl7LjNhIAAAA1/williamjkp-williamest.gif',
    'https://media.tenor.com/5jczFlfwb1MAAAAM/williamjkp-williamlykn.gif',
    'https://media.tenor.com/iewm3JkU8voAAAAM/babygirl-william-williamjkp-aneexwe.gif',
    'https://media.tenor.com/wJjoKm3PVq4AAAAM/lykn-williamjkp.gif',
    'https://media.tenor.com/TC3L3Zw1o30AAAAM/lykn-williamjkp.gif',
    'https://media.tenor.com/NmYJlXKZObIAAAAM/william-jkp-est-supha.gif',
    'https://media.tenor.com/yeQx53aqTkgAAAAM/williamest-william-jakrapatr.gif',
    'https://media.tenor.com/34X9eRqlj7AAAAAM/williamest-william-jakrapatr.gif',
    'https://media.tenor.com/GqjoloWQ_CQAAAAM/william-jakrapatr-williamest.gif',
    'https://media.tenor.com/EyppIOnQ_RkAAAA1/williamest-william-jakrapatr.gif',
    'https://media.tenor.com/OxjMIY5IMXsAAAAM/william-jakrapatr-williamjkp.gif',
    'https://media.tenor.com/6-kM3CW9wskAAAAM/william-lykn-lykn.gif',
    'https://media.tenor.com/Vt2Qi3C5p4QAAAAM/williamjkp-william-lykn.gif'
];

// Configuración de textos
const locations = ['California 🇺🇸','Seúl 🇰🇷','Tokio 🇯🇵','París 🇫🇷','Londres 🇬🇧','Buenos Aires 🇦🇷','Madrid 🇪🇸','Berlín 🇩🇪','Sídney 🇦🇺','Toronto 🇨🇦'];
const jobs = ['cashier at a Lego store','backup dancer in a Kpop MV','barista at Starbucks','actor in a commercial','taxi driver','dog walker','ice cream seller','photographer','DJ at a club','karaoke host'];
const outcomes = ['but they got fired for stealing merchandise.','but quit after 5 minutes.','and got promoted instantly!','but spilled coffee on the manager.','and made new friends!','but ended up sleeping on the job.','and earned a fanbase of locals.','but forgot to show up the next day.'];

// CAMBIO DE COOLDOWN A 5 MINUTOS
const COOLDOWN_TIME = 5 * 60 * 1000; 

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('💼 Envía a tu idol favorito a trabajar y gana monedas'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    try {
      // 1. VERIFICACIÓN DE COOLDOWN
      let { data: userCheck } = await supabase
          .from('users')
          .select('last_work_claim')
          .eq('user_id', userId)
          .single();
      
      const lastUsed = userCheck?.last_work_claim || 0;
      const remaining = COOLDOWN_TIME - (now - lastUsed);

      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        return interaction.reply({
          content: `⏳ Debes esperar **${minutes}m ${seconds}s** antes de volver a usar \`/work\`.`,
          ephemeral: true
        });
      }

      await interaction.deferReply();

      // 2. OBTENER USUARIO
      const { data: user, error: userError } = await supabase.from('users').select('*').eq('user_id', userId).single();
      
      // Si el usuario no existe, lo creamos para que pueda trabajar
      let finalUser = user;
      if (!user) {
          const { data: newUser } = await supabase.from('users').insert({ user_id: userId }).select().single();
          finalUser = newUser;
      }
      
      if (userError && userError.code !== 'PGRST116') {
         // Si es un error real de DB (y no solo "no encontrado")
         return interaction.editReply('❌ Error al conectar con la base de datos.');
      }

      // 3. DATOS DEL IDOL FAVORITO
      let idolName = 'tu idol favorito';
      if (finalUser.favorite_card_id) {
        const { data: favCard } = await supabase
          .from('user_cards')
          .select(`unique_card_id, base_cards (name)`)
          .eq('unique_card_id', finalUser.favorite_card_id)
          .eq('user_id', userId)
          .single();
        if (favCard?.base_cards?.name) {
          idolName = favCard.base_cards.name.replace(/[-—★].*$/, '').trim();
        }
      }

      // 4. GENERAR TEXTOS
      const location = locations[Math.floor(Math.random() * locations.length)];
      const job = jobs[Math.floor(Math.random() * jobs.length)];
      const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
      const reward = Math.floor(Math.random() * 51) + 100;
      // Usamos 'balance' o 'currency' según tu DB (aquí asumo 'balance' por tu código previo)
      const newBalance = (finalUser.balance || 0) + reward; 

      // 5. ACTUALIZAR DB + NOTIFICACIÓN
      const { error: updateError } = await supabase
        .from('users')
        .update({ 
            balance: newBalance,
            last_work_claim: now,
            work_notified: false 
        })
        .eq('user_id', userId);

      if (updateError) throw updateError;

      // 6. HISTORIAL
      await supabase.from('history_logs').insert({
          user_id: userId,
          action_type: 'work',
          amount: reward,
          details: `Trabajó como ${job} en ${location}`
      });

      // 7. PREPARAR GIF Y EMBED
      // Usamos AttachmentBuilder para asegurar que se vea
      const randomGifUrl = williamGifs[Math.floor(Math.random() * williamGifs.length)];
      const gifFile = new AttachmentBuilder(randomGifUrl, { name: 'work.gif' });

      let embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle('💼 Work Result')
        .setDescription(
            `${interaction.user.username} and **${idolName}** went to ${location}.\n` +
            `They found a job as a ${job}.\n` +
            `${interaction.user.username} earned **${reward} ${moneyEmoji}**, now they have **${newBalance} ${moneyEmoji}**.\n` +
            `In the end, ${outcome}`
        )
        .setImage('attachment://work.gif') // Referencia al archivo creado
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [gifFile] });

    } catch (err) {
      console.error('Error en /work:', err);
      // Evitamos el error de "Interaction already acknowledged"
      if (!interaction.deferred && !interaction.replied) {
          await interaction.reply({ content: '❌ Ocurrió un error inesperado.', ephemeral: true });
      } else {
          await interaction.editReply('❌ Ocurrió un error inesperado al procesar el trabajo.');
      }
    }
  }
};
