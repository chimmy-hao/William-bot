const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const moneyEmoji = '<:berrycoin:1411737957081288724>';
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
    // 1. VERIFICACIÓN DE COOLDOWN (BASE DE DATOS)
    // ---------------------------------------------------------
    
    // Leemos la columna last_work_claim
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

    // ---------------------------------------------------------
    // 2. LÓGICA DEL COMANDO (INTACTA)
    // ---------------------------------------------------------

    try {
      await interaction.deferReply();

      const { data: user, error: userError } = await supabase.from('users').select('*').eq('user_id', userId).single();
      if (userError || !user) return interaction.editReply('❌ No encontré tu perfil. Usa `/photocard` primero para registrarte.');

      let idolName = 'tu idol favorito';
      if (user.favorite_card_id) {
        const { data: favCard } = await supabase
          .from('user_cards')
          .select(`unique_card_id, base_cards (name)`)
          .eq('unique_card_id', user.favorite_card_id)
          .eq('user_id', userId)
          .single();
        if (favCard && favCard.base_cards && favCard.base_cards.name) {
          idolName = favCard.base_cards.name.replace(/[-—★].*$/, '').trim();
        }
      }

      const location = locations[Math.floor(Math.random() * locations.length)];
      const job = jobs[Math.floor(Math.random() * jobs.length)];
      const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
      const reward = Math.floor(Math.random() * 51) + 100;
      const newBalance = user.balance + reward;

      // Guardar balance actualizado Y EL TIEMPO en Supabase
      const { error: updateError } = await supabase
        .from('users')
        .update({ 
            balance: newBalance,
            last_work_claim: now // <--- ESTO GUARDA EL TIEMPO
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error al actualizar el balance:', updateError);
        return interaction.editReply('❌ Hubo un error al actualizar tu balance.');
      }

      // GIF local
      const attachment = new AttachmentBuilder('./work.gif');

      const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle('💼 Work Result')
        .setDescription(`${interaction.user.username} and **${idolName}** went to ${location}.\nThey found a job as a ${job}.\n${interaction.user.username} earned **${reward} ${moneyEmoji}**, now they have **${newBalance} ${moneyEmoji}**.\nIn the end, ${outcome}`)
        .setImage('attachment://work.gif')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [attachment] });

    } catch (err) {
      console.error('Error en /work:', err);
      await interaction.editReply('❌ Hubo un error al ejecutar /work.');
    }
  }
};


