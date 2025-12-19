const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const moneyEmoji = '<:berrycoin:1411737957081288724>';

// --- BASE DE DATOS DE GIFS (Puedes agregar cientos aquí) ---
const williamGifs = [
    'https://media.tenor.com/2fJj2R2q4wEAAAAC/william-jakrapatr.gif', 
    'https://media.tenor.com/uN2jX7q1wEAAAAC/project-alpha-william.gif',
    'https://64.media.tumblr.com/7a68369e96024949510168925501865a/d5d2999426f3080e-31/s540x810/3741009852264585640203099080517700206195.gif',
    'https://media.tenor.com/images/3342345/william-smile.gif', // (Ejemplo, agrega tus links reales aquí)
    'https://media.tenor.com/P5Q4X1wEAAAAC/lykn-william.gif'
];

// Configuración de textos
const locations = ['California 🇺🇸','Seúl 🇰🇷','Tokio 🇯🇵','París 🇫🇷','Londres 🇬🇧','Buenos Aires 🇦🇷','Madrid 🇪🇸','Berlín 🇩🇪','Sídney 🇦🇺','Toronto 🇨🇦'];
const jobs = ['cashier at a Lego store','backup dancer in a Kpop MV','barista at Starbucks','actor in a commercial','taxi driver','dog walker','ice cream seller','photographer','DJ at a club','karaoke host'];
const outcomes = ['but they got fired for stealing merchandise.','but quit after 5 minutes.','and got promoted instantly!','but spilled coffee on the manager.','and made new friends!','but ended up sleeping on the job.','and earned a fanbase of locals.','but forgot to show up the next day.'];

const COOLDOWN_TIME = 3 * 60 * 1000; // 3 Minutos

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('💼 Envía a tu idol favorito a trabajar y gana monedas'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    // ---------------------------------------------------------
    // 1. VERIFICACIÓN DE COOLDOWN
    // ---------------------------------------------------------
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

    try {
      await interaction.deferReply();

      // Obtener datos del usuario
      const { data: user, error: userError } = await supabase.from('users').select('*').eq('user_id', userId).single();
      if (userError || !user) return interaction.editReply('❌ No encontré tu perfil. Usa `/photocard` primero.');

      // Determinar nombre del Idol
      let idolName = 'tu idol favorito';
      if (user.favorite_card_id) {
        const { data: favCard } = await supabase
          .from('user_cards')
          .select(`unique_card_id, base_cards (name)`)
          .eq('unique_card_id', user.favorite_card_id)
          .eq('user_id', userId)
          .single();
        if (favCard?.base_cards?.name) {
          idolName = favCard.base_cards.name.replace(/[-—★].*$/, '').trim();
        }
      }

      // Generar historia y recompensa
      const location = locations[Math.floor(Math.random() * locations.length)];
      const job = jobs[Math.floor(Math.random() * jobs.length)];
      const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
      const reward = Math.floor(Math.random() * 51) + 100;
      const newBalance = user.balance + reward;

      // ---------------------------------------------------------
      // 2. ACTUALIZACIÓN DB + NOTIFICACIÓN + HISTORIAL
      // ---------------------------------------------------------

      // A) Actualizar saldo, tiempo y RESETEAR NOTIFICACIÓN (work_notified: false)
      const { error: updateError } = await supabase
        .from('users')
        .update({ 
            balance: newBalance,
            last_work_claim: now,
            work_notified: false // <--- 🔔 IMPORTANTE: Activa el aviso futuro
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error DB:', updateError);
        return interaction.editReply('❌ Error al guardar datos.');
      }

      // B) Guardar en Historial
      await supabase.from('history_logs').insert({
          user_id: userId,
          action_type: 'work',
          amount: reward,
          details: `Trabajó como ${job} en ${location}`
      });

      // ---------------------------------------------------------
      // 3. RESPUESTA VISUAL (GIF ALEATORIO)
      // ---------------------------------------------------------

      // Seleccionar un GIF aleatorio de la lista
      // Si la lista falla por algo, usa un placeholder seguro
      const randomGif = williamGifs.length > 0 
        ? williamGifs[Math.floor(Math.random() * williamGifs.length)] 
        : 'https://media.tenor.com/2fJj2R2q4wEAAAAC/william-jakrapatr.gif';

      const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle('💼 Work Result')
        .setDescription(
            `${interaction.user.username} and **${idolName}** went to ${location}.\n` +
            `They found a job as a ${job}.\n` +
            `${interaction.user.username} earned **${reward} ${moneyEmoji}**, now they have **${newBalance} ${moneyEmoji}**.\n` +
            `In the end, ${outcome}`
        )
        .setImage(randomGif) // <--- Usamos el link directo, ya no attachment
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] }); // Quitamos 'files: []'

    } catch (err) {
      console.error('Error en /work:', err);
      await interaction.editReply('❌ Hubo un error al ejecutar /work.');
    }
  }
};
